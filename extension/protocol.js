export const DEFAULTS = { enabled: false, url: 'ws://127.0.0.1:8222', prefix: 'mesh.browser', label: '', token: '', user: '', pass: '', creds: '' };
export function validateConfig(raw) {
  const c = { ...DEFAULTS, ...raw };
  const u = new URL(c.url);
  if (!['ws:', 'wss:'].includes(u.protocol) || u.username || u.password) throw new Error('NATS WebSocket adresi ws:// veya wss:// olmalı; kimlik bilgilerini ayrı alanlara yazın.');
  if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(c.prefix)) throw new Error('Geçersiz konu öneki.');
  if (c.token && (c.user || c.pass || c.creds) || c.creds && (c.user || c.pass)) throw new Error('Tek bir kimlik doğrulama yöntemi seçin.');
  return c;
}
export function subjects(prefix, id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Geçersiz profil kimliği.');
  return { cmd: `${prefix}.cmd.${id}`, abort: `${prefix}.abort.${id}`, info: `${prefix}.info.${id}`,
    discover: `${prefix}.discover`, register: `${prefix}.register.${id}`, heartbeat: `${prefix}.heartbeat.${id}`,
    stream: `${prefix}.stream.${id}`, invoke: `${prefix}.invoke.${id}` };
}
export function validateCommand(cmd) {
  if (!cmd || typeof cmd.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(cmd.id)) throw new Error('Komut id gerekli (1–128 harf/rakam/_/-).');
  if (!Array.isArray(cmd.steps) || cmd.steps.length === 0 || cmd.steps.length > 200) throw new Error('steps 1–200 adım içermeli.');
  for (const s of cmd.steps) {
    if (!s || typeof s !== 'object' || (s.v !== undefined && typeof s.v !== 'string')) throw new Error('Geçersiz adım.');
  }
  return cmd;
}
