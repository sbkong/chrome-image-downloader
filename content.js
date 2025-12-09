document.addEventListener('click', async function(event) {
  if (!event.altKey) return;

  const target = event.target;
  if (target.tagName !== 'IMG') return;

  event.preventDefault();
  event.stopPropagation();

  const imageUrl = target.src || target.currentSrc;
  if (!imageUrl) return;

  const originalBorder = target.style.border;
  target.style.border = '3px solid #4CAF50';
  setTimeout(() => { target.style.border = originalBorder; }, 500);

  try {
    await chrome.runtime.sendMessage({
      action: 'downloadImage',
      url: imageUrl,
      referer: window.location.href
    });
  } catch (error) {
  }
}, true);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadBlob') {
    const uint8Array = new Uint8Array(request.data);
    const blob = new Blob([uint8Array], { type: request.type });

    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = request.filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }, 100);

  } else if (request.action === 'downloadDirect') {
    const a = document.createElement('a');
    a.href = request.url;
    a.download = '';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 100);
  }
});