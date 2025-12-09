document.addEventListener('click', async function(event) {
  if (!event.altKey) return;

  const target = event.target;
  if (target.tagName !== 'IMG') return;

  event.preventDefault();
  event.stopPropagation();

  const imageUrl = target.src || target.currentSrc;
  if (!imageUrl) return;

  console.log('이미지 URL:', imageUrl);

  const originalBorder = target.style.border;
  target.style.border = '3px solid #4CAF50';
  setTimeout(() => { target.style.border = originalBorder; }, 500);

  chrome.runtime.sendMessage({
    action: 'downloadImage',
    url: imageUrl,
    referer: window.location.href
  });
}, true);