let currentReferer = null;
const RULE_ID = 12345;

// Filenames we intend to assign, in initiation order. onDeterminingFilename is
// the authoritative hook for naming a download and choosing its subfolder: it
// overrides Chrome's generic default ("다운로드.png") that appears because the
// download() filename option is dropped for data: URLs.
const pendingPaths = [];

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const path = pendingPaths.shift();
  if (path) {
    suggest({ filename: path, conflictAction: 'uniquify' });
  } else {
    suggest();
  }
});

chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.action === 'downloadImage') {
    currentReferer = request.referer || sender.url;
    handleDownload(request.url, currentReferer, request.title || '');
  }
});

async function handleDownload(imageUrl, referer, title) {
  const subfolder = await getSubfolder(referer, title);

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [RULE_ID],
      addRules: [{
        id: RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{
            header: 'Referer',
            operation: 'set',
            value: referer
          }]
        },
        condition: {
          urlFilter: '*',
          resourceTypes: ['xmlhttprequest']
        }
      }]
    });

    const response = await fetch(imageUrl, {
      headers: {
        'Referer': referer
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const filename = getFilenameFromResponse(imageUrl, response);
    const dataUrl = await blobToDataUrl(blob);
    const path = buildPath(subfolder, filename);

    pendingPaths.push(path);
    await chrome.downloads.download({
      url: dataUrl,
      filename: path,
      conflictAction: 'uniquify'
    });

    setTimeout(() => {
      chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [RULE_ID]
      });
    }, 10000);

  } catch (error) {
    // Fallback: let Chrome fetch and download the image directly.
    try {
      const fbPath = buildPath(subfolder, getFilename(imageUrl));
      pendingPaths.push(fbPath);
      await chrome.downloads.download({
        url: imageUrl,
        filename: fbPath,
        conflictAction: 'uniquify'
      });
    } catch (e) {}
  }
}

async function getSubfolder(referer, title) {
  const { subfolder } = await chrome.storage.sync.get('subfolder');
  let pattern = (subfolder || '').trim();
  if (!pattern) return '';

  let domain = '';
  try {
    domain = new URL(referer).hostname;
  } catch {}

  // Keep the title a single path segment: collapse separators and cap length so
  // it can't spawn nested dirs or blow past OS path limits.
  const safeTitle = (title || '').replace(/[\\/]+/g, ' ').trim().slice(0, 100);

  pattern = pattern
    .replace(/\{domain\}/g, domain)
    .replace(/\{title\}/g, safeTitle);

  return sanitizePath(pattern);
}

function sanitizePath(path) {
  return path
    .split(/[\\/]+/)
    .map(sanitizeSegment)
    .filter(Boolean)
    .join('/');
}

function sanitizeSegment(segment) {
  // Strip characters that are illegal in Windows/macOS paths and guard against
  // directory traversal (".", "..").
  const cleaned = segment
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  return /^\.+$/.test(cleaned) ? '' : cleaned;
}

function buildPath(subfolder, filename) {
  // Collapse any path separators in the leaf so it can never spawn its own subdirs.
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
      if (filename && filename.includes('.')) {
        return filename;
      }
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
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/bmp': 'bmp',
      'image/svg+xml': 'svg'
    };
    ext = typeMap[contentType.split(';')[0].trim()] || ext;
  }

  return `image_${Date.now()}.${ext}`;
}

function getFilename(url) {
  try {
    if (url.includes('viewimage')) {
      return `img_${Date.now()}.jpg`;
    }

    const urlPath = new URL(url).pathname;
    const filename = urlPath.split('/').pop();

    if (filename && filename.includes('.')) {
      return decodeURIComponent(filename);
    }

    return `image_${Date.now()}.jpg`;
  } catch {
    return `image_${Date.now()}.jpg`;
  }
}
