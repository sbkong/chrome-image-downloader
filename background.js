let currentReferer = null;
const RULE_ID = 12345;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadImage') {

    currentReferer = request.referer || sender.url;

    handleDownload(request.url);
  }
});

async function handleDownload(imageUrl) {
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

    const base64 = await blobToBase64(blob);

    const filename = getFilename(imageUrl);

    chrome.downloads.download({
      url: base64,
      filename: filename,
      saveAs: false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('다운로드 실패:', chrome.runtime.lastError);
      } else {
        console.log('다운로드 성공:', downloadId);
      }

      setTimeout(() => {
        chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [RULE_ID]
        });
      }, 10000);
    });

  } catch (error) {
    console.error('오류:', error);

    tryDirectDownload(imageUrl);
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function tryDirectDownload(imageUrl) {
  const filename = getFilename(imageUrl);

  const separator = imageUrl.includes('?') ? '&' : '?';
  const downloadUrl = `${imageUrl}${separator}_t=${Date.now()}`;

  chrome.downloads.download({
    url: downloadUrl,
    filename: filename,
    saveAs: false,
    conflictAction: 'uniquify'
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error('다운로드 실패:', chrome.runtime.lastError);
    } else {
      console.log('다운로드 성공:', downloadId);
    }
  });
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