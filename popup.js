const input = document.getElementById('subfolder');
const status = document.getElementById('status');

chrome.storage.sync.get('subfolder', ({ subfolder }) => {
  input.value = subfolder || '';
});

document.getElementById('save').addEventListener('click', () => {
  chrome.storage.sync.set({ subfolder: input.value.trim() }, () => {
    status.textContent = '저장되었습니다';
    setTimeout(() => { status.textContent = ''; }, 1500);
  });
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('save').click();
});
