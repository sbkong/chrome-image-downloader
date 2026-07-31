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
    (async () => {
      const g = await chrome.storage.session.get('downloads');
      Object.assign(downloads, g.downloads || {});
      await verifyDownloads(); // drop finished files the user has since deleted
      sendResponse(downloads);
    })();
    return true;
  }
  if (request.action === 'thumb') {
    // The popup couldn't load this image directly (hotlink / referer). Fetch it
    // here with the page's Referer and hand back a data URL for the thumbnail.
    fetchImageDataUrl(request.url, request.referer)
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch(() => sendResponse({ dataUrl: null }));
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

// Drop "done" entries whose file no longer exists on disk (user deleted it), so
// their control goes back to "download". Uses the Downloads API's `exists` flag
// (cheap — no external process). Missing download records count as deleted.
async function verifyDownloads() {
  const dones = Object.keys(downloads).filter((u) => downloads[u] && downloads[u].state === 'done' && downloads[u].downloadId != null);
  if (!dones.length) return;
  await Promise.all(dones.map((u) => new Promise((resolve) => {
    chrome.downloads.search({ id: downloads[u].downloadId }, (items) => {
      const it = items && items[0];
      if (!it || it.exists === false) {
        const tabId = downloads[u].tabId;
        delete downloads[u];
        // Same broadcast path as a live update, so both the popup row AND the
        // on-image badge fall back to "download".
        broadcast({ url: u, state: 'idle' }, tabId);
      }
      resolve();
    });
  })));
  chrome.storage.session.set({ downloads });
}

// ---- Shared state ---------------------------------------------------------
// runtime.sendMessage reaches the popup; content scripts (the on-image badge)
// only get messages sent to their tab. Send to both.
function broadcast(status, tabId) {
  chrome.runtime.sendMessage({ action: 'status', status }).catch(() => {});
  if (tabId != null) chrome.tabs.sendMessage(tabId, { action: 'status', status }).catch(() => {});
}

function setDL(url, patch, tabId) {
  downloads[url] = Object.assign({ url }, downloads[url], patch);
  if (tabId != null && downloads[url].tabId == null) downloads[url].tabId = tabId;
  chrome.storage.session.set({ downloads });
  const tid = tabId != null ? tabId : downloads[url].tabId;
  broadcast(Object.assign({}, downloads[url]), tid);
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

// Fetch an image with the page's Referer (via a transient DNR rule) so hotlink-
// protected thumbnails the popup can't load directly still show. Same-page thumbs
// share one referer, so a single rule serves a burst; it self-removes when idle.
const THUMB_RULE_ID = 12346;
let thumbRuleTimer = null;
async function ensureThumbReferer(referer) {
  if (!referer) return;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [THUMB_RULE_ID],
    addRules: [{
      id: THUMB_RULE_ID,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: referer }] },
      condition: { urlFilter: '*', resourceTypes: ['xmlhttprequest'] }
    }]
  });
  if (thumbRuleTimer) clearTimeout(thumbRuleTimer);
  thumbRuleTimer = setTimeout(() => {
    chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [THUMB_RULE_ID] });
    thumbRuleTimer = null;
  }, 20000);
}

async function fetchImageDataUrl(url, referer) {
  await ensureThumbReferer(referer);
  const resp = await fetch(url, { headers: { 'Referer': referer || '' } });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const blob = await resp.blob();
  if (!/^image\//.test(blob.type) || blob.size > 8 * 1024 * 1024) throw new Error('unsuitable');
  return await blobToDataUrl(blob);
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
