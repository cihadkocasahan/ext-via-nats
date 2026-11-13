import { DEFAULTS, validateConfig } from './protocol.js';

const TEXT = {
  en: {
    title: 'Connect this browser',
    lede: 'This Chrome profile joins a NATS subject and waits for commands from an MCP-capable agent. Nothing is polled, no debug port is opened.',
    choose: '1 · Where does your NATS run?',
    localTitle: 'Local or your own server',
    localBody: 'ws:// on your machine or LAN. Free, no account.',
    cloudTitle: 'NATS Cloud',
    cloudBody: 'wss:// with a .creds file. Reaches browsers behind NAT.',
    localStepsTitle: 'Start a local broker',
    localStepsBody: 'That starts NATS with WebSocket on 127.0.0.1:8222. Already running one, or have a server on your LAN? Skip this and type its address below.',
    cloudStepsTitle: 'Get your .creds file',
    cloudStep1: 'Sign in to Synadia Cloud and create an Account.',
    cloudStep2: 'Inside that account create a User.',
    cloudStep3: 'Open “Get Connected” for the user and download the .creds file.',
    cloudStep4: 'Paste the whole file into the .creds field below. The URL field is prefilled with the public cloud WebSocket address; if your account panel shows a different one, use that.',
    cloudEndpointNote: 'The quick-start guide shows tls://connect.ngs.global — the native NATS client address, which a browser cannot use. This extension speaks NATS over WebSocket, so the cloud preset fills wss://connect.ngs.global:443. That address answers a real NATS handshake; your .creds still authenticates you. Neither the TCP (4222) nor the monitoring (8222) port speaks WebSocket.',
    gatewayNote: 'The HTTP Gateway is a different door: REST over HTTPS with an Authorization: Bearer API token. This extension does not use it — a browser cannot hold a long-lived request/reply subscription over REST. Use the .creds WebSocket path above.',
    linkQuickStart: 'Quick start (account, user, .creds)',
    linkGateway: 'HTTP Gateway (not used here)',
    settingsTitle: '2 · Connection',
    label: 'Profile label', labelPlaceholder: 'Work laptop · Chrome 1',
    url: 'NATS WebSocket address',
    urlHint: 'Local: ws://HOST:8222 · Cloud: wss://HOST:PORT. Credentials never go inside the URL.',
    prefix: 'Subject prefix',
    prefixHint: 'Every subject this profile uses starts with it. Keep it identical in the MCP server config.',
    auth: 'Authentication — pick one',
    token: 'Token', user: 'User', pass: 'Password', creds: 'NATS .creds contents',
    secretHint: "Credentials stay in this profile's local extension storage. They are not sent to Chrome Sync and never travel in a NATS message. This storage is not an OS password vault: anyone with this profile can read it.",
    enabled: 'Enable the remote connection', save: 'Save and connect',
    footer: 'Commands are authorised by the subject permissions of the NATS account you connect with. Each profile gets its own identity; an email address is not one. An abort request takes effect at the next step boundary.',
    instPrefix: 'Profile identity: ', instPending: 'being created',
    saved: 'Settings saved.',
    status: { connected: 'Connected', connecting: 'Connecting…', reconnecting: 'Reconnecting…', disabled: 'Connection off', disconnected: 'Disconnected', error: 'Connection error', unknown: 'Reading state…' },
    errors: { bad_url: 'The NATS address must be ws:// or wss://. Put credentials in their own fields, not in the URL.', bad_prefix: 'Invalid subject prefix: use letters, digits, _ and - separated by dots.', auth_conflict: 'Pick one authentication method: token, user/password, or .creds.' },
  },
  tr: {
    title: 'Bu tarayıcıyı bağla',
    lede: 'Bu Chrome profili bir NATS konusuna katılır ve MCP destekli bir agenttan komut bekler. Yoklama yapılmaz, hata ayıklama portu açılmaz.',
    choose: '1 · NATS nerede çalışıyor?',
    localTitle: 'Yerel veya kendi sunucun',
    localBody: 'Makinende ya da yerel ağda ws://. Ücretsiz, hesap gerekmez.',
    cloudTitle: 'NATS Cloud',
    cloudBody: '.creds dosyasıyla wss://. NAT arkasındaki tarayıcılara erişir.',
    localStepsTitle: 'Yerel broker başlat',
    localStepsBody: 'Bu komut NATSı 127.0.0.1:8222 üzerinde WebSocket ile başlatır. Zaten çalışan bir sunucun mu var? Bu adımı atla ve adresini aşağıya yaz.',
    cloudStepsTitle: '.creds dosyanı al',
    cloudStep1: 'Synadia Clouda giriş yap ve bir Account oluştur.',
    cloudStep2: 'Bu account içinde bir User oluştur.',
    cloudStep3: 'Kullanıcı için “Get Connected” panelini aç ve .creds dosyasını indir.',
    cloudStep4: 'Dosyanın tamamını aşağıdaki .creds alanına yapıştır. URL alanı genel bulut WebSocket adresiyle önceden doldurulur; account panelin farklı bir adres gösteriyorsa onu kullan.',
    cloudEndpointNote: 'Quick-start kılavuzunda tls://connect.ngs.global görünür; bu, yerli NATS istemcisinin adresidir ve tarayıcı onu kullanamaz. Bu eklenti NATSı WebSocket üzerinden konuşur; bu yüzden bulut ön seçimi wss://connect.ngs.global:443 adresini doldurur. Bu adres gerçek bir NATS el sıkışmasına yanıt verir; kimlik doğrulamayı yine .creds dosyan yapar. TCP (4222) ve monitoring (8222) portları WebSocket konuşmaz.',
    gatewayNote: 'HTTP Gateway ayrı bir kapıdır: HTTPS üzerinden REST ve Authorization: Bearer API token. Bu eklenti onu kullanmaz — tarayıcı REST üzerinde uzun ömürlü bir request/reply aboneliği tutamaz. Yukarıdaki .creds + WebSocket yolunu kullan.',
    linkQuickStart: 'Quick start (account, user, .creds)',
    linkGateway: 'HTTP Gateway (burada kullanılmıyor)',
    settingsTitle: '2 · Bağlantı',
    label: 'Profil etiketi', labelPlaceholder: 'İş bilgisayarı · Chrome 1',
    url: 'NATS WebSocket adresi',
    urlHint: 'Yerel: ws://SUNUCU:8222 · Bulut: wss://SUNUCU:PORT. Kimlik bilgileri URL içine yazılmaz.',
    prefix: 'Konu öneki',
    prefixHint: 'Bu profilin kullandığı bütün konular bununla başlar. MCP sunucu ayarında da aynısı olmalı.',
    auth: 'Kimlik doğrulama — tek yöntem seç',
    token: 'Token', user: 'Kullanıcı', pass: 'Parola', creds: 'NATS .creds içeriği',
    secretHint: 'Kimlik bilgileri yalnızca bu profilin yerel eklenti deposunda kalır. Chrome Synce gönderilmez ve NATS mesajında taşınmaz. Bu depo bir işletim sistemi parola kasası değildir: profile erişen herkes okuyabilir.',
    enabled: 'Uzaktan bağlantıyı etkinleştir', save: 'Kaydet ve bağlan',
    footer: 'Komutlar, bağlandığın NATS hesabının konu izinleriyle yetkilendirilir. Her profil ayrı kimlik alır; mail adresi kimlik değildir. Durdurma isteği bir sonraki adım sınırında uygulanır.',
    instPrefix: 'Profil kimliği: ', instPending: 'oluşturuluyor',
    saved: 'Ayarlar kaydedildi.',
    status: { connected: 'Bağlı', connecting: 'Bağlanıyor…', reconnecting: 'Yeniden bağlanıyor…', disabled: 'Bağlantı kapalı', disconnected: 'Bağlantı kesildi', error: 'Bağlantı hatası', unknown: 'Durum okunuyor…' },
    errors: { bad_url: 'NATS adresi ws:// veya wss:// olmalı. Kimlik bilgilerini URLye değil, kendi alanlarına yaz.', bad_prefix: 'Geçersiz konu öneki: harf, rakam, _ ve - kullan, nokta ile ayır.', auth_conflict: 'Tek bir kimlik doğrulama yöntemi seç: token, kullanıcı/parola veya .creds.' },
  },
};

const CLOUD_WS = 'wss://connect.ngs.global:443';
const form = document.querySelector('form');
const fields = Object.keys(DEFAULTS);
const statusEl = document.querySelector('#status');
const instEl = document.querySelector('#inst');
const feedback = document.querySelector('#feedback');
let lang = 'en';
let lastStatus = null;
let lastInst = '';

function applyLang(next) {
  lang = TEXT[next] ? next : 'en';
  const t = TEXT[lang];
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const value = t[el.dataset.i18n];
    if (typeof value === 'string') el.textContent = value;
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t[el.dataset.i18nPlaceholder] || '';
  for (const el of document.querySelectorAll('.lang button')) el.setAttribute('aria-pressed', String(el.dataset.lang === lang));
  renderStatus(lastStatus);
  renderInst(lastInst);
}
function renderStatus(status) {
  lastStatus = status;
  const state = status?.state || 'unknown';
  statusEl.dataset.state = state;
  statusEl.textContent = (TEXT[lang].status[state] || TEXT[lang].status.unknown) + (status?.error ? ' · ' + status.error : '');
}
function renderInst(inst) {
  lastInst = inst || '';
  instEl.dataset.inst = lastInst;
  instEl.textContent = TEXT[lang].instPrefix + (lastInst || TEXT[lang].instPending);
}
function preset(name) {
  for (const el of document.querySelectorAll('.card')) el.setAttribute('aria-pressed', String(el.dataset.preset === name));
  document.querySelector('#local-help').hidden = name !== 'local';
  document.querySelector('#cloud-help').hidden = name !== 'cloud';
  const url = form.elements.url;
  if (name === 'local' && !url.value.trim()) url.value = DEFAULTS.url;
  // Verified by an unauthenticated NATS INFO handshake: this public endpoint
  // speaks NATS over WebSocket. Authentication still comes from the user's .creds.
  if (name === 'cloud' && (!url.value.trim() || url.value.trim() === DEFAULTS.url)) url.value = CLOUD_WS;
}

const stored = await chrome.storage.local.get(['extViaNatsConfig', 'extViaNatsLang']);
const config = stored.extViaNatsConfig;
for (const key of fields) {
  const el = form.elements[key];
  if (key === 'enabled') el.checked = !!config?.enabled;
  else el.value = config?.[key] ?? DEFAULTS[key];
}
applyLang(stored.extViaNatsLang);
preset(String(config?.url || '').startsWith('wss://') ? 'cloud' : 'local');
renderStatus((await chrome.storage.session.get('extViaNatsStatus')).extViaNatsStatus);
renderInst((await chrome.storage.local.get('extViaNatsInst')).extViaNatsInst);

for (const el of document.querySelectorAll('.lang button')) el.addEventListener('click', () => {
  applyLang(el.dataset.lang);
  void chrome.storage.local.set({ extViaNatsLang: lang });
});
for (const el of document.querySelectorAll('.card')) el.addEventListener('click', () => preset(el.dataset.preset));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.extViaNatsStatus) renderStatus(changes.extViaNatsStatus.newValue);
  if (area === 'local' && changes.extViaNatsInst) renderInst(changes.extViaNatsInst.newValue);
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const data = Object.fromEntries(fields.map(key => [key, key === 'enabled' ? form.elements[key].checked : form.elements[key].value.trim()]));
    // Preserve significant whitespace in passwords.
    data.pass = form.elements.pass.value;
    await chrome.storage.local.set({ extViaNatsConfig: validateConfig(data) });
    feedback.textContent = TEXT[lang].saved;
  } catch (e) { feedback.textContent = TEXT[lang].errors[e.code] || e.message; }
});