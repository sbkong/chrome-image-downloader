// Modifier+Click on an image hands its URL to the background (chrome.downloads).
// The combo is configurable in the popup (default Alt + left click).
let clickMod = 'alt';
let clickButton = 'left';
let shortcutEnabled = true;
let badgeEnabled = true; // show the on-image hover button

chrome.storage.sync.get(['clickMod', 'clickButton', 'shortcutEnabled', 'badgeEnabled'], (s) => {
  if (s.clickMod) clickMod = s.clickMod;
  if (s.clickButton) clickButton = s.clickButton;
  if (s.shortcutEnabled !== undefined) shortcutEnabled = s.shortcutEnabled !== false;
  if (s.badgeEnabled !== undefined) badgeEnabled = s.badgeEnabled !== false;
});
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'sync') return;
  if (c.clickMod) clickMod = c.clickMod.newValue || 'alt';
  if (c.clickButton) clickButton = c.clickButton.newValue || 'left';
  if (c.shortcutEnabled) shortcutEnabled = c.shortcutEnabled.newValue !== false;
  if (c.badgeEnabled) { badgeEnabled = c.badgeEnabled.newValue !== false; scheduleBadges(); }
});

function modMatches(e) {
  const need = { ctrl: false, alt: false, shift: false, meta: false };
  clickMod.split('+').forEach((k) => { if (k in need) need[k] = true; });
  if (!(need.ctrl || need.alt || need.shift || need.meta)) return false; // never fire on a plain click
  return e.ctrlKey === need.ctrl && e.altKey === need.alt && e.shiftKey === need.shift && e.metaKey === need.meta;
}

function handleShortcut(event) {
  if (!shortcutEnabled) return;
  if (!modMatches(event)) return;
  const found = resolveImageAt(event);
  if (!found) return;
  event.preventDefault();
  event.stopPropagation();
  flash(found.el);
  triggerDownload(found.url);
}

// Left-click on 'click'; right-click on 'contextmenu' (also suppresses the menu).
document.addEventListener('click', function (event) {
  if (clickButton !== 'left') return;
  handleShortcut(event);
}, true);
document.addEventListener('contextmenu', function (event) {
  if (clickButton !== 'right') return;
  handleShortcut(event);
}, true);

function triggerDownload(url) {
  try {
    chrome.runtime.sendMessage({ action: 'downloadImage', url: url, referer: location.href, title: document.title });
  } catch (e) {}
}

// Resolve the image under a point, seeing through transparent overlays and CSS
// background-image when there is no <img>.
function resolveImageAt(event) {
  const stack = document.elementsFromPoint(event.clientX, event.clientY);
  for (const el of stack) {
    if (el.tagName === 'IMG') {
      const url = el.currentSrc || el.src;
      if (url) return { el, url };
    }
  }
  for (const el of stack) {
    const url = backgroundImageUrl(el);
    if (url) return { el, url };
  }
  return null;
}

function backgroundImageUrl(el) {
  const bg = getComputedStyle(el).backgroundImage;
  if (!bg || bg === 'none') return null;
  const match = bg.match(/url\((['"]?)(.*?)\1\)/i);
  if (!match || !match[2]) return null;
  try { return new URL(match[2], location.href).href; } catch { return null; }
}

function flash(el) {
  if (!el || !el.style) return;
  const original = el.style.outline;
  el.style.outline = '3px solid #4CAF50';
  setTimeout(() => { el.style.outline = original; }, 500);
}

// ---- Popup requests / status broadcasts ----------------------------------
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req && req.action === 'listImages') { sendResponse({ images: collectImages() }); return; }
  if (req && req.action === 'status') { applyBadgeStatus(req.status); }
});

// Real, downloadable images on the page (http(s), rendered large enough to matter).
function collectImages() {
  const out = [];
  const seen = new Set();
  document.querySelectorAll('img').forEach((im) => {
    const url = im.currentSrc || im.src;
    if (!url || !/^https?:/i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    const r = im.getBoundingClientRect();
    if (r.width < 32 || r.height < 32) return; // skip icons / spacers
    let label;
    try { label = decodeURIComponent(new URL(url, location.href).pathname.split('/').pop() || url); } catch (e) { label = url; }
    const w = im.naturalWidth || Math.round(r.width) || 0;
    const h = im.naturalHeight || Math.round(r.height) || 0;
    const dim = (w && h) ? (w + 'x' + h) : '';
    out.push({ url: url, label: label, dim: dim, thumb: url, w: w, h: h });
  });
  return out;
}

// ---- On-image download badge (shown on hover, top-right of the image) ------
// Mirrors the popup button: download (green) -> downloading (blue) -> open folder
// (green), driven by the background's status broadcasts, matched here by URL.
const DL_ICON =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" ' +
  'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M5 21h14"/></svg>';
const FOLDER_ICON =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" ' +
  'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1H3z"/><path d="M3 10h18l-1.5 8a2 2 0 0 1-2 1.5H6.5a2 2 0 0 1-2-1.5z"/></svg>';

const BG = {
  idle: 'rgba(76,175,80,.95)',       // green
  downloading: 'rgba(21,101,192,.95)', // blue
  done: 'rgba(46,125,50,.95)',       // dark green
  error: 'rgba(198,40,40,.95)'       // red
};

const imgBadges = new Map(); // img element -> badge element
let badgeScheduled = false;
let ptrX = -1, ptrY = -1;
let dlCache = {};            // url -> last known status (shared with popup)

chrome.runtime.sendMessage({ action: 'getDownloads' }, (m) => {
  void chrome.runtime.lastError;
  dlCache = m || {};
  imgBadges.forEach(hydrateBadge);
  scheduleBadges();
});

function renderBadge(b) {
  const s = b.dataset.state || 'idle';
  b.style.background = BG[s] || BG.idle;
  if (s === 'downloading') {
    b.innerHTML = '<span style="color:#fff;font:700 9px/1 -apple-system,Segoe UI,sans-serif">…</span>';
    b.title = 'Downloading';
  } else if (s === 'done') {
    b.innerHTML = FOLDER_ICON; b.title = 'Open folder';
  } else {
    b.innerHTML = DL_ICON; b.title = (s === 'error') ? 'Failed - click to retry' : 'Download this image';
  }
}

function stateFromStatus(st) {
  if (st.state === 'downloading') return 'downloading';
  if (st.state === 'done' || st.state === 'error') return st.state;
  return 'idle';
}

function applyStatusToBadge(b, st) {
  b.dataset.state = stateFromStatus(st);
  renderBadge(b);
}

function hydrateBadge(b) {
  const u = b.dataset.dlurl;
  if (u && dlCache[u]) { applyStatusToBadge(b, dlCache[u]); return; }
  if (b.dataset.state === 'done') { b.dataset.state = 'idle'; renderBadge(b); }
}

function startBadge(b, url) {
  b.dataset.state = 'downloading';
  renderBadge(b);
  scheduleBadges();
  b.dataset.dlurl = url;
  triggerDownload(url);
}

function makeBadge(el, url) {
  const b = document.createElement('div');
  b.setAttribute('aria-label', 'Download image');
  b.dataset.state = 'idle';
  b.dataset.dlurl = url;
  b.style.cssText = [
    'position:fixed', 'z-index:2147483647', 'width:30px', 'height:30px',
    'box-sizing:border-box', 'display:none', 'align-items:center', 'justify-content:center',
    'border-radius:50%', 'box-shadow:0 1px 5px rgba(0,0,0,.45)',
    'cursor:pointer', 'transition:transform .1s, background .1s', 'padding:0', 'border:0'
  ].join(';');
  renderBadge(b);
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['mousedown', 'pointerdown', 'contextmenu'].forEach((t) => b.addEventListener(t, stop, true));
  b.addEventListener('mouseenter', () => { b.style.transform = 'scale(1.12)'; });
  b.addEventListener('mouseleave', () => { b.style.transform = 'scale(1)'; });
  b.addEventListener('click', (e) => {
    stop(e);
    const s = b.dataset.state;
    if (s === 'downloading') return;
    if (s === 'done') { chrome.runtime.sendMessage({ action: 'reveal', url: b.dataset.dlurl }); return; }
    startBadge(b, b.dataset.dlurl); // idle or error -> start / retry
  }, true);
  document.documentElement.appendChild(b);
  hydrateBadge(b);
  return b;
}

function applyBadgeStatus(s) {
  if (!s || !s.url) return;
  dlCache[s.url] = s;
  imgBadges.forEach((b) => { if (b.dataset.dlurl === s.url) applyStatusToBadge(b, s); });
  scheduleBadges();
}

// The image under the cursor (big enough to bother with), through overlays.
function imageAt(x, y) {
  if (x < 0) return null;
  const stack = document.elementsFromPoint(x, y);
  for (const el of stack) {
    if (el.tagName === 'IMG') {
      const r = el.getBoundingClientRect();
      if (r.width >= 48 && r.height >= 48) return { el, url: el.currentSrc || el.src };
    }
  }
  for (const el of stack) {
    const url = backgroundImageUrl(el);
    if (url) {
      const r = el.getBoundingClientRect();
      if (r.width >= 48 && r.height >= 48) return { el, url };
    }
  }
  return null;
}

function positionBadges() {
  badgeScheduled = false;
  if (!badgeEnabled) { imgBadges.forEach((b) => { b.style.display = 'none'; }); return; }
  // Only track the hovered image plus any image currently downloading / done, so
  // we never iterate/measure every image on the page.
  const hovered = imageAt(ptrX, ptrY);
  if (hovered && hovered.url && !imgBadges.has(hovered.el)) {
    imgBadges.set(hovered.el, makeBadge(hovered.el, hovered.url));
  }
  imgBadges.forEach((b, el) => {
    if (!el.isConnected) { b.remove(); imgBadges.delete(el); return; }
    const r = el.getBoundingClientRect();
    const onScreen = r.width > 24 && r.height > 24 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    const persist = b.dataset.state === 'downloading' || b.dataset.state === 'done';
    const isHover = hovered && hovered.el === el;
    if ((!isHover && !persist) || !onScreen) { b.style.display = 'none'; return; }
    b.style.display = 'flex';
    // Just outside the top-right corner; clamp to the viewport.
    const size = 30, gap = 6;
    let top = r.top + gap;
    let left = r.right + gap;
    if (left + size > innerWidth - 2) left = r.right - size - gap;
    top = Math.max(2, Math.min(top, innerHeight - size - 2));
    left = Math.max(2, Math.min(left, innerWidth - size - 2));
    b.style.top = top + 'px';
    b.style.left = left + 'px';
  });
}

function scheduleBadges() {
  if (badgeScheduled) return;
  badgeScheduled = true;
  requestAnimationFrame(positionBadges);
}

addEventListener('mousemove', (e) => { ptrX = e.clientX; ptrY = e.clientY; scheduleBadges(); }, true);
addEventListener('scroll', scheduleBadges, true);
addEventListener('resize', scheduleBadges, true);
try { new MutationObserver(scheduleBadges).observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
scheduleBadges();
