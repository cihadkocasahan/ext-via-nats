import { DEFAULTS, validateConfig } from './protocol.js';
const form = document.querySelector('form');
const fields = Object.keys(DEFAULTS);
const { meshConfig } = await chrome.storage.local.get('meshConfig');
for (const key of fields) {
  const el = form.elements[key];
  if (key === 'enabled') el.checked = !!meshConfig?.enabled;
  else el.value = meshConfig?.[key] ?? DEFAULTS[key];
}
function render(status) {
  const names = { connected: 'Bağlı', connecting: 'Bağlanıyor…', reconnecting: 'Yeniden bağlanıyor…', disabled: 'Bağlantı kapalı', disconnected: 'Bağlantı kesildi', error: 'Bağlantı hatası' };
  document.querySelector('#status').textContent = (names[status?.state] || 'Bağlantı bekleniyor') + (status?.error ? ' · ' + status.error : '');
}
render((await chrome.storage.session.get('meshStatus')).meshStatus);
document.querySelector('#inst').textContent = 'Profil kimliği: ' + ((await chrome.storage.local.get('arInst')).arInst || 'oluşturuluyor');
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes.meshStatus) render(changes.meshStatus.newValue); });
form.addEventListener('submit', async event => {
  event.preventDefault();
  const feedback = document.querySelector('#feedback');
  try {
    const data = Object.fromEntries(fields.map(key => [key, key === 'enabled' ? form.elements[key].checked : form.elements[key].value.trim()]));
    // Preserve significant whitespace in passwords.
    data.pass = form.elements.pass.value;
    await chrome.storage.local.set({ meshConfig: validateConfig(data) });
    feedback.textContent = 'Ayarlar kaydedildi.';
  } catch (e) { feedback.textContent = e.message; }
});
