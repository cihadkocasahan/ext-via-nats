export const DEFAULTS = { enabled: false, url: 'ws://127.0.0.1:8222', prefix: 'extvianats.browser', label: '', token: '', user: '', pass: '', creds: '' };
const fail = (code, message) => Object.assign(new Error(message), { code });
export function validateConfig(raw) {
  const c = { ...DEFAULTS, ...raw };
  const u = new URL(c.url);
  if (!['ws:', 'wss:'].includes(u.protocol) || u.username || u.password) throw fail('bad_url', 'The NATS address must be ws:// or wss://. Put credentials in their own fields, not in the URL.');
  if (!/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(c.prefix)) throw fail('bad_prefix', 'Invalid subject prefix: use letters, digits, _ and - separated by dots.');
  if (c.token && (c.user || c.pass || c.creds) || c.creds && (c.user || c.pass)) throw fail('auth_conflict', 'Pick one authentication method: token, user/password, or .creds.');
  return c;
}
export function subjects(prefix, id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw fail('bad_inst', 'Invalid profile identity.');
  return { cmd: `${prefix}.cmd.${id}`, abort: `${prefix}.abort.${id}`, info: `${prefix}.info.${id}`,
    discover: `${prefix}.discover`, register: `${prefix}.register.${id}`, heartbeat: `${prefix}.heartbeat.${id}`,
    stream: `${prefix}.stream.${id}`, invoke: `${prefix}.invoke.${id}` };
}
export function validateCommand(cmd) {
  if (!cmd || typeof cmd.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(cmd.id)) throw fail('bad_command_id', 'A command id is required (1-128 letters, digits, _ or -).');
  if (!Array.isArray(cmd.steps) || cmd.steps.length === 0 || cmd.steps.length > 200) throw fail('bad_steps', 'steps must contain 1-200 entries.');
  for (const s of cmd.steps) {
    if (!s || typeof s !== 'object' || (s.v !== undefined && typeof s.v !== 'string')) throw fail('bad_step', 'Invalid step.');
  }
  return cmd;
}