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

  try {
    await chrome.runtime.sendMessage({
      action: 'downloadImage',
      url: imageUrl,
      referer: window.location.href
    });
  } catch (error) {
    console.warn('메시지 전송 실패:', error);
    alert('확장 프로그램을 새로고침해주세요.');
  }
}, true);

// background.js로부터 다운로드 명령 수신
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadBlob') {
    // Uint8Array를 Blob으로 변환
    const uint8Array = new Uint8Array(request.data);
    const blob = new Blob([uint8Array], { type: request.type });

    // Blob URL 생성
    const blobUrl = URL.createObjectURL(blob);

    // 다운로드 링크 생성 및 클릭
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = request.filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    // 정리
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }, 100);

    console.log('✅ 다운로드 완료:', request.filename);
  } else if (request.action === 'downloadDirect') {
    // 직접 다운로드 시도
    const a = document.createElement('a');
    a.href = request.url;
    a.download = '';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 100);
  }
});