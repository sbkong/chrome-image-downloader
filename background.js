let currentReferer = null;
const RULE_ID = 12345;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadImage') {
    currentReferer = request.referer || sender.url;
    handleDownload(request.url, sender.tab.id);
  }
});

async function handleDownload(imageUrl, tabId) {
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
            value: currentReferer
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
        'Referer': currentReferer
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const filename = getFilenameFromResponse(imageUrl, response);

    console.log('추출된 파일명:', filename);

    // Blob을 ArrayBuffer로 변환하여 content script로 전송
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = Array.from(new Uint8Array(arrayBuffer));

    chrome.tabs.sendMessage(tabId, {
      action: 'downloadBlob',
      data: uint8Array,
      filename: filename,
      type: blob.type
    });

    setTimeout(() => {
      chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [RULE_ID]
      });
    }, 10000);

  } catch (error) {
    console.error('오류:', error);
    chrome.tabs.sendMessage(tabId, {
      action: 'downloadDirect',
      url: imageUrl
    });
  }
}

function getFilenameFromResponse(url, response) {
  const contentDisposition = response.headers.get('content-disposition');
  if (contentDisposition) {
    const filenameMatch = contentDisposition.match(/filename[^;=\n]*=["']?([^"'\n;]+)["']?/i);
    console.log('파일명 매치:', filenameMatch);
    if (filenameMatch && filenameMatch[1]) {
      const filename = decodeURIComponent(filenameMatch[1].trim());
      console.log('추출된 파일명:', filename);
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