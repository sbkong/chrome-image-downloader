const t = (key) => chrome.i18n.getMessage(key);

document.title = t('actionTitle');
document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });

const listEl = document.getElementById('list');
let activeTab = null;

// Tabs: Images / Settings
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === tab));
    document.querySelectorAll('.tabpane').forEach((p) => { p.hidden = (p.id !== 'tab-' + tab.dataset.tab); });
  });
});

const selectAll = document.getElementById('selectAll');
const downloadSelBtn = document.getElementById('downloadSel');

downloadSelBtn.addEventListener('click', () => {
  [...listEl.querySelectorAll('li')].forEach((li) => {
    const c = li.querySelector('input.sel');
    const b = li.querySelector('button');
    if (c && c.checked && !c.disabled && b && b.dataset.state === 'idle') onButton(b);
  });
});
selectAll.addEventListener('change', () => {
  selectableChecks().forEach((c) => { c.checked = selectAll.checked; });
  updateSelectionUI();
});

const selectableChecks = () => [...listEl.querySelectorAll('input.sel')].filter((c) => !c.disabled);
function rowCheck(btn) { const li = btn.closest && btn.closest('li'); return li ? li.querySelector('input.sel') : null; }
function updateSelectionUI() {
  const checks = selectableChecks();
  const checked = checks.filter((c) => c.checked);
  selectAll.checked = checks.length > 0 && checked.length === checks.length;
  selectAll.indeterminate = checked.length > 0 && checked.length < checks.length;
  selectAll.disabled = checks.length === 0;
  downloadSelBtn.disabled = checked.length === 0;
}

function currentTab() {
  return new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, (x) => resolve(x && x[0])));
}
function getImages(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'listImages' }, (resp) => {
      void chrome.runtime.lastError;
      resolve((resp && resp.images) || []);
    });
  });
}

async function loadImages() {
  activeTab = await currentTab();
  listEl.innerHTML = '';
  if (!activeTab) return;
  render(await getImages(activeTab.id));
  hydrateFromBackground();
}

function hydrateFromBackground() {
  chrome.runtime.sendMessage({ action: 'getDownloads' }, (map) => {
    void chrome.runtime.lastError;
    if (map) Object.keys(map).forEach((url) => onStatus(map[url]));
  });
}

// A row: [checkbox] [thumb] [name + dim] [status] [button(다운로드→진행중→폴더 열기)]
function makeRow(img) {
  const li = document.createElement('li');

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'sel';
  check.checked = false;
  check.addEventListener('change', updateSelectionUI);

  const thumb = document.createElement('img');
  thumb.className = 'thumb';
  thumb.src = img.thumb || img.url;
  thumb.loading = 'lazy';

  const meta = document.createElement('div');
  meta.className = 'meta';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = img.label;
  name.title = img.url;
  meta.appendChild(name);
  if (img.dim) {
    const dim = document.createElement('span');
    dim.className = 'dim';
    dim.textContent = img.dim;
    meta.appendChild(dim);
  }

  const status = document.createElement('span');
  status.className = 'rowStatus';

  const btn = document.createElement('button');
  btn.className = 'small';
  btn.textContent = t('dlBtn');
  btn.dataset.url = img.url;
  btn.dataset.state = 'idle';
  btn._status = status;
  btn._label = t('dlBtn');
  btn.addEventListener('click', () => onButton(btn));

  const pick = document.createElement('label');
  pick.className = 'pick';
  pick.appendChild(check);
  pick.appendChild(thumb);
  pick.appendChild(meta);

  li.appendChild(pick);
  li.appendChild(status);
  li.appendChild(btn);
  listEl.appendChild(li);
  return btn;
}

function onButton(btn) {
  if (btn.dataset.state === 'done') {
    chrome.runtime.sendMessage({ action: 'reveal', url: btn.dataset.url });
    return;
  }
  if (btn.dataset.state === 'downloading') return;
  applyStatus(btn, { state: 'downloading' }); // optimistic
  chrome.runtime.sendMessage({
    action: 'downloadImage',
    url: btn.dataset.url,
    referer: activeTab ? activeTab.url : '',
    title: activeTab ? activeTab.title : '',
    tabId: activeTab ? activeTab.id : undefined
  });
}

const buttonsForUrl = (url) => [...listEl.querySelectorAll('button')].filter((b) => b.dataset.url === url);

function applyStatus(btn, s) {
  const c = rowCheck(btn);
  if (s.state === 'downloading') {
    btn.disabled = true;
    btn.dataset.state = 'downloading';
    btn.classList.remove('done');
    btn.textContent = t('stDownloading');
    if (c) { c.checked = false; c.disabled = true; }
    if (btn._status) { btn._status.classList.remove('err'); btn._status.textContent = ''; }
  } else if (s.state === 'done') {
    btn.disabled = false;
    btn.dataset.state = 'done';
    btn.classList.add('done');
    btn.textContent = t('openFolderBtn');
    if (c) { c.checked = false; c.disabled = true; }
    if (btn._status) { btn._status.classList.remove('err'); btn._status.textContent = t('stDone'); }
  } else if (s.state === 'error') {
    btn.disabled = false;
    btn.dataset.state = 'idle';
    btn.classList.remove('done');
    btn.textContent = btn._label;
    if (c) { c.disabled = false; }
    if (btn._status) { btn._status.classList.add('err'); btn._status.textContent = s.message || t('stError'); }
  }
  updateSelectionUI();
}

function onStatus(s) {
  if (!s || !s.url) return;
  buttonsForUrl(s.url).forEach((b) => applyStatus(b, s));
}

function render(images) {
  listEl.innerHTML = '';
  images.forEach((img) => makeRow(img));
  if (!images.length) {
    const li = document.createElement('li'); li.className = 'empty'; li.textContent = t('noImages'); listEl.appendChild(li);
  }
  updateSelectionUI();
}

document.getElementById('refresh').addEventListener('click', loadImages);
chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.action === 'status') onStatus(msg.status); });

// ---- Settings: subfolder + click shortcut + on-image button toggle ---------
const subfolderInput = document.getElementById('subfolder');
const shortcutEnabledInput = document.getElementById('shortcutEnabled');
const badgeEnabledInput = document.getElementById('badgeEnabled');
const captureEl = document.getElementById('shortcutCapture');
const saveStatus = document.getElementById('saveStatus');

const MOD_ORDER = ['ctrl', 'alt', 'shift', 'meta'];
const MOD_LABEL = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta' };
const comboLabel = (mods) => mods.map((m) => MOD_LABEL[m]).join(' + ');
const modsFromEvent = (e) => MOD_ORDER.filter((m) => ({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey })[m]);

let clickModMods = ['alt'];
let clickButton = 'left';
let flashTimer = null;

const buttonLabel = () => t(clickButton === 'right' ? 'clickRight' : 'clickLeft');
const fullLabel = () => comboLabel(clickModMods) + ' + ' + buttonLabel();

function renderShortcut() {
  const enabled = shortcutEnabledInput.checked;
  captureEl.classList.toggle('disabled', !enabled);
  captureEl.classList.remove('capturing');
  captureEl.textContent = clickModMods.length ? fullLabel() : t('shortcutCapturePlaceholder');
  const usageEl = document.querySelector('.usage');
  if (usageEl) {
    usageEl.textContent = (enabled && clickModMods.length)
      ? t('usage').replace('{combo}', fullLabel())
      : t('usageNoShortcut');
  }
}

function persistShortcut() {
  chrome.storage.sync.set({ clickMod: clickModMods.join('+'), clickButton: clickButton, shortcutEnabled: shortcutEnabledInput.checked });
}

captureEl.addEventListener('mousedown', (e) => {
  if (!shortcutEnabledInput.checked) return;
  e.preventDefault();
  if (e.button === 1) return; // ignore middle click
  const mods = modsFromEvent(e);
  if (!mods.length) {
    captureEl.classList.add('capturing');
    captureEl.textContent = t('shortcutCaptureActive');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(renderShortcut, 1300);
    return;
  }
  clickModMods = mods;
  clickButton = (e.button === 2) ? 'right' : 'left';
  renderShortcut();
  persistShortcut();
});
captureEl.addEventListener('contextmenu', (e) => e.preventDefault());
shortcutEnabledInput.addEventListener('change', () => { renderShortcut(); persistShortcut(); });
badgeEnabledInput.addEventListener('change', () => { chrome.storage.sync.set({ badgeEnabled: badgeEnabledInput.checked }); });

chrome.storage.sync.get(['subfolder', 'clickMod', 'clickButton', 'shortcutEnabled', 'badgeEnabled'], (s) => {
  subfolderInput.value = s.subfolder || '';
  clickModMods = (s.clickMod || 'alt').split('+').filter(Boolean);
  clickButton = s.clickButton || 'left';
  shortcutEnabledInput.checked = (s.shortcutEnabled !== false);
  badgeEnabledInput.checked = (s.badgeEnabled !== false);
  renderShortcut();
});

document.getElementById('save').addEventListener('click', () => {
  chrome.storage.sync.set({ subfolder: subfolderInput.value.trim() }, () => {
    saveStatus.textContent = t('savedStatus');
    setTimeout(() => { saveStatus.textContent = ''; }, 1500);
  });
});
subfolderInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('save').click(); });

loadImages();
