const RULE_ID = 12345;

// Intended filenames for the downloads we start, in order.
const pendingPaths = [];

// Shared download state, keyed by image URL, so the popup list and the on-image
// hover button stay in sync. Mirrored to session storage so it survives the popup
// closing / the service worker sleeping.
// url -> { state:'downloading'|'done'|'error', downloadId, filename, tabId, message }
const downloads = {};
const idToUrl = {};
const ACTIVE = { downloading: 1 };
chrome.storage.session.get('downloads').then((g) => { Object.assign(downloads, g.downloads || {}); });

// Register onDeterminingFilename ONLY while a download is in flight; it is global
// (fires for every browser download), so a permanently-registered listener from
// each extension makes Chrome's conflict resolution drop filenames. Keeping it
// registered only while actively downloading means an idle extension never
// interferes with the companion Video Downloader's downloads.
function determineFilename(item, suggest) {
  const path = pendingPaths.shift();
  if (path) suggest({ filename: path, conflictAction: 'uniquify' });
  else suggest();
  if (pendingPaths.length === 0) chrome.downloads.onDeterminingFilename.removeListener(determineFilename);
}

function enqueue(path) {
  pendingPaths.push(path);
  if (!chrome.downloads.onDeterminingFilename.hasListener(determineFilename)) {
    chrome.downloads.onDeterminingFilename.addListener(determineFilename);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadImage') {
    const url = request.url;
    const referer = request.referer || sender.url || (sender.tab && sender.tab.url) || '';
    const tabId = request.tabId != null ? request.tabId : (sender.tab && sender.tab.id);
    if (url) startImageDownload(url, referer, request.title || '', tabId);
    sendResponse({ url: url || null });
    return;
  }
  if (request.action === 'getDownloads') {
    chrome.storage.session.get('downloads').then((g) => sendResponse(g.downloads || {}));
    return true;
  }
  if (request.action === 'reveal') {
    const d = downloads[request.url];
    try {
      if (d && d.downloadId != null) chrome.downloads.show(d.downloadId);
      else chrome.downloads.showDefaultFolder();
    } catch (e) {}
    sendResponse({ ok: true });
    return;
  }
});

// ---- Shared state ---------------------------------------------------------
function setDL(url, patch, tabId) {
  downloads[url] = Object.assign({ url }, downloads[url], patch);
  if (tabId != null && downloads[url].tabId == null) downloads[url].tabId = tabId;
  chrome.storage.session.set({ downloads });
  const status = Object.assign({}, downloads[url]);
  chrome.runtime.sendMessage({ action: 'status', status }).catch(() => {});
  const tid = tabId != null ? tabId : downloads[url].tabId;
  if (tid != null) chrome.tabs.sendMessage(tid, { action: 'status', status }).catch(() => {});
}

async function startImageDownload(imageUrl, referer, title, tabId) {
  const cur = downloads[imageUrl];
  if (cur && ACTIVE[cur.state]) { setDL(imageUrl, {}, tabId); return; } // already going
  setDL(imageUrl, { state: 'downloading', downloadId: null, filename: null, message: null }, tabId);

  const subfolder = await getSubfolder(referer, title);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [RULE_ID],
      addRules: [{
        id: RULE_ID,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: referer }] },
        condition: { urlFilter: '*', resourceTypes: ['xmlhttprequest'] }
      }]
    });

    const response = await fetch(imageUrl, { headers: { 'Referer': referer } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const blob = await response.blob();
    const filename = getFilenameFromResponse(imageUrl, response);
    const dataUrl = await blobToDataUrl(blob);
    const path = buildPath(subfolder, filename);

    enqueue(path);
    const id = await chrome.downloads.download({ url: dataUrl, filename: path, conflictAction: 'uniquify' });
    idToUrl[id] = imageUrl;
    setDL(imageUrl, { downloadId: id }, tabId);

    setTimeout(() => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID] }), 10000);
  } catch (error) {
    // Fallback: let Chrome fetch and download the image directly.
    try {
      const fbPath = buildPath(subfolder, getFilename(imageUrl));
      enqueue(fbPath);
      const id = await chrome.downloads.download({ url: imageUrl, filename: fbPath, conflictAction: 'uniquify' });
      idToUrl[id] = imageUrl;
      setDL(imageUrl, { downloadId: id }, tabId);
    } catch (e) {
      setDL(imageUrl, { state: 'error', message: String(error && error.message || error) }, tabId);
    }
  }
}

// Report completion / failure back to the shared state (and both UIs).
chrome.downloads.onChanged.addListener((delta) => {
  const url = idToUrl[delta.id];
  if (!url || !downloads[url]) return;
  if (delta.state && delta.state.current === 'complete') {
    chrome.downloads.search({ id: delta.id }, (items) => {
      const fn = (items && items[0]) ? items[0].filename : null;
      setDL(url, { state: 'done', filename: fn });
    });
    delete idToUrl[delta.id];
  } else if (delta.state && delta.state.current === 'interrupted') {
    setDL(url, { state: 'error', message: (delta.error && delta.error.current) || 'interrupted' });
    delete idToUrl[delta.id];
  }
});

// ---- Subfolder / filename helpers ----------------------------------------
async function getSubfolder(referer, title) {
  const { subfolder } = await chrome.storage.sync.get('subfolder');
  let pattern = (subfolder || '').trim();
  if (!pattern) return '';

  let domain = '';
  try { domain = new URL(referer).hostname; } catch {}

  const safeTitle = (title || '').replace(/[\\/]+/g, ' ').trim().slice(0, 100);
  pattern = pattern.replace(/\{domain\}/g, domain).replace(/\{title\}/g, safeTitle);
  return sanitizePath(pattern);
}

function sanitizePath(path) {
  return path.split(/[\\/]+/).map(sanitizeSegment).filter(Boolean).join('/');
}

function sanitizeSegment(segment) {
  const cleaned = segment.replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim();
  return /^\.+$/.test(cleaned) ? '' : cleaned;
}

function buildPath(subfolder, filename) {
  const leaf = sanitizeSegment(filename.replace(/[\\/]+/g, '_')) || `image_${Date.now()}.jpg`;
  return subfolder ? `${subfolder}/${leaf}` : leaf;
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  const type = blob.type || 'application/octet-stream';
  return `data:${type};base64,${btoa(binary)}`;
}

function getFilenameFromResponse(url, response) {
  const contentDisposition = response.headers.get('content-disposition');
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(/filename[^;=\n]*=["']?([^"'\n;]+)["']?/i);
    if (filenameMatch && filenameMatch[1]) {
      const filename = decodeURIComponent(filenameMatch[1].trim());
      if (filename && filename.includes('.')) return filename;
    }
  }

  const urlFilename = getFilename(url);
  if (urlFilename && urlFilename.includes('.') && !urlFilename.startsWith('img_') && !urlFilename.startsWith('image_')) {
    return urlFilename;
  }

  const contentType = response.headers.get('content-type');
  let ext = 'jpg';
  if (contentType) {
    const typeMap = {
      'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
      'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg'
    };
    ext = typeMap[contentType.split(';')[0].trim()] || ext;
  }
  return `image_${Date.now()}.${ext}`;
}

function getFilename(url) {
  try {
    if (url.includes('viewimage')) return `img_${Date.now()}.jpg`;
    const urlPath = new URL(url).pathname;
    const filename = urlPath.split('/').pop();
    if (filename && filename.includes('.')) return decodeURIComponent(filename);
    return `image_${Date.now()}.jpg`;
  } catch {
    return `image_${Date.now()}.jpg`;
  }
}
