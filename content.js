document.addEventListener('click', async function(event) {
  if (!event.altKey) return;

  const found = resolveImageAt(event);
  if (!found) return;

  event.preventDefault();
  event.stopPropagation();

  flash(found.el);

  try {
    await chrome.runtime.sendMessage({
      action: 'downloadImage',
      url: found.url,
      referer: window.location.href,
      title: document.title
    });
  } catch (error) {
  }
}, true);

// Resolve the image under the click point, seeing through transparent overlays
// and picking up CSS background-image when there is no <img> element.
function resolveImageAt(event) {
  const stack = document.elementsFromPoint(event.clientX, event.clientY);

  // 1) A real <img> anywhere in the stack (handles transparent overlays on top).
  for (const el of stack) {
    if (el.tagName === 'IMG') {
      const url = el.currentSrc || el.src;
      if (url) return { el, url };
    }
  }

  // 2) An element whose CSS background-image is a real url(...).
  for (const el of stack) {
    const url = backgroundImageUrl(el);
    if (url) return { el, url };
  }

  return null;
}

function backgroundImageUrl(el) {
  const bg = getComputedStyle(el).backgroundImage;
  if (!bg || bg === 'none') return null;

  // Take the first url(...) token; ignore gradients.
  const match = bg.match(/url\((['"]?)(.*?)\1\)/i);
  if (!match || !match[2]) return null;

  try {
    return new URL(match[2], location.href).href;
  } catch {
    return null;
  }
}

function flash(el) {
  if (!el || !el.style) return;
  const original = el.style.outline;
  el.style.outline = '3px solid #4CAF50';
  setTimeout(() => { el.style.outline = original; }, 500);
}
