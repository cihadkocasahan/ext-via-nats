import { wsconnect, credsAuthenticator } from '@nats-io/nats-core';
import { initExecutor, execute, abortCommand, sessionInfo } from './executor.js';
import { DEFAULTS, validateConfig, validateCommand, subjects } from './protocol.js';

let nc, config, topic, active = null, connecting = null, generation = 0;
const encoder = new TextEncoder();
const encode = x => encoder.encode(JSON.stringify(x));
const status = (state, error = null) => chrome.storage.session.set({ extViaNatsStatus: { state, error, at: Date.now() } });
const emit = (subject, data) => { if (nc && !nc.isClosed()) nc.publish(subject, encode(data)); };
const ready = initExecutor({
  announce: info => topic && emit(topic.register, { ...info, label: config.label }),
  invoke: data => topic && emit(topic.invoke, data),
  step: data => topic && emit(topic.stream, data),
});
// Content scripts must not be able to read broker credentials or command history.
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

async function respond(msg, data) {
  // Only standard request inboxes are reply targets. Never accept payload reply subjects.
  if (/^_INBOX\.[a-zA-Z0-9_.-]+$/.test(msg.reply || '')) msg.respond(encode(data));
}
async function handleCommand(msg) {
  let cmd;
  try { cmd = validateCommand(msg.json()); }
  catch (e) { await respond(msg, { ok: false, code: 'invalid_command', error: e.message }); return; }
  if (active) { await respond(msg, { ok: false, id: cmd.id, code: active === cmd.id ? 'in_progress' : 'busy' }); return; }
  active = cmd.id; // reserve before any asynchronous storage operation
  try {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encode(cmd)))).map(b => b.toString(16).padStart(2, '0')).join('');
    const { extViaNatsLedger = {} } = await chrome.storage.local.get('extViaNatsLedger');
    const previous = Object.hasOwn(extViaNatsLedger, cmd.id) ? extViaNatsLedger[cmd.id] : null;
    if (previous) {
      await respond(msg, previous.hash !== hash ? { ok: false, id: cmd.id, code: 'id_conflict' }
        : previous.result || { ok: false, id: cmd.id, code: 'interrupted', error: 'Önceki çalışmanın sonucu belirsiz; otomatik tekrar çalıştırılmadı.' });
      return;
    }
    // At-most-once per retained id: persist intent BEFORE executing a browser action.
    const ledger = Object.fromEntries(Object.entries(extViaNatsLedger).slice(-99));
    ledger[cmd.id] = { hash, at: Date.now() };
    await chrome.storage.local.set({ extViaNatsLedger: ledger });
    emit(topic.stream, { id: cmd.id, phase: 'started' });
    const result = { id: cmd.id, ...await execute(cmd) };
    result.ok = !result.err && !result.aborted && result.receipts.every(r => r.ok);
    ledger[cmd.id].result = result;
    await chrome.storage.local.set({ extViaNatsLedger: ledger });
    emit(topic.stream, { id: cmd.id, phase: 'done', ok: result.ok });
    await respond(msg, result);
  } catch {
    await respond(msg, { ok: false, id: cmd.id, code: 'execution_error', error: 'Çalıştırma veya sonuç kaydı başarısız; aynı id ile tekrar sorgulayın.' });
  } finally { active = null; }
}
function listen(client, subject, handler) {
  client.subscribe(subject, { callback: (err, msg) => {
    if (err) { void status('error', 'NATS aboneliği başarısız.'); return; }
    void Promise.resolve().then(() => handler(msg)).catch(() => respond(msg, { ok: false, code: 'invalid_request' }));
  } });
}
async function heartbeat() {
  if (!nc || nc.isClosed() || !topic) return;
  emit(topic.heartbeat, { inst: await ready, label: config.label, running: active, timestamp: Date.now() });
}
async function start() {
  if (connecting) return connecting;
  if (nc && !nc.isClosed()) return;
  const ticket = generation;
  connecting = (async () => {
    await storageReady;
    const { extViaNatsConfig } = await chrome.storage.local.get('extViaNatsConfig');
    config = validateConfig(extViaNatsConfig || DEFAULTS);
    if (!config.enabled) { await status('disabled'); return; }
    await status('connecting');
    const id = await ready;
    topic = subjects(config.prefix, id);
    const client = await wsconnect({ servers: config.url, name: `ext-via-nats-${id}`, timeout: 5000,
      pingInterval: 15000, maxReconnectAttempts: -1, reconnectTimeWait: 2000,
      ignoreServerUpdates: true,
      ...(config.creds ? { authenticator: credsAuthenticator(encoder.encode(config.creds)) }
        : config.token ? { token: config.token } : config.user ? { user: config.user, pass: config.pass } : {}) });
    if (ticket !== generation) { await client.close(); return; }
    nc = client;
    listen(client, topic.cmd, handleCommand);
    listen(client, topic.abort, async msg => {
      const { id } = msg.json();
      await respond(msg, { ok: abortCommand(id), id, inst: await ready });
    });
    const info = async msg => respond(msg, { ...await sessionInfo(), label: config.label, running: active });
    listen(client, topic.info, info);
    listen(client, topic.discover, info);
    await client.flush();
    emit(topic.register, { ...await sessionInfo(), label: config.label });
    await heartbeat();
    await status('connected');
    void (async () => {
      for await (const s of client.status()) {
        if (client !== nc) return;
        if (s.type === 'disconnect') await status('reconnecting');
        if (s.type === 'reconnect') { emit(topic.register, { ...await sessionInfo(), label: config.label }); await heartbeat(); await status('connected'); }
        if (s.type === 'error') await status('error', 'NATS yetki veya bağlantı hatası; broker izinlerini kontrol edin.');
      }
    })();
    void client.closed().then(() => { if (nc === client) { nc = null; void status('disconnected'); } });
  })().catch(async () => { if (nc) { await nc.close(); nc = null; } await status('error', 'NATS bağlantısı kurulamadı. Adres, TLS ve kimlik bilgilerini kontrol edin.'); })
    .finally(() => { connecting = null; });
  return connecting;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.extViaNatsConfig) return;
  generation++;
  if (active) abortCommand(active);
  void (async () => { if (nc) await nc.close(); nc = null; if (connecting) await connecting; await start(); })();
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.runtime.onStartup.addListener(() => { void start(); });
chrome.runtime.onInstalled.addListener(() => { void start(); });
chrome.alarms.create('ext-via-nats-reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'ext-via-nats-reconnect') void start(); });
setInterval(() => { void heartbeat().catch(() => {}); }, 5000);
void start();
