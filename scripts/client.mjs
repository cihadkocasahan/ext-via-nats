import { wsconnect, credsAuthenticator } from '@nats-io/nats-core';
import { readFile } from 'node:fs/promises';
import { validateConfig, validateCommand, subjects } from '../src/protocol.js';
export class RemoteMeshClient {
  constructor(env = process.env) {
    this.config = validateConfig({ url: env.REMOTE_MESH_URL || 'ws://127.0.0.1:8222', prefix: env.REMOTE_MESH_PREFIX || 'mesh.browser',
      token: env.REMOTE_MESH_TOKEN || '', user: env.REMOTE_MESH_USER || '', pass: env.REMOTE_MESH_PASS || '' });
    this.credsFile = env.REMOTE_MESH_CREDS;
  }
  async connect() {
    if (this.nc && !this.nc.isClosed()) return this.nc;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const c = this.config;
      if (this.credsFile && (c.token || c.user || c.pass)) throw new Error('Tek bir NATS kimlik doğrulama yöntemi seçin.');
      this.nc = await wsconnect({ servers: c.url, timeout: 5000, name: 'remote-mesh-controller', ignoreServerUpdates: true,
        ...(this.credsFile ? { authenticator: credsAuthenticator(await readFile(this.credsFile)) }
          : c.token ? { token: c.token } : c.user ? { user: c.user, pass: c.pass } : {}) });
      return this.nc;
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
  async list(waitMs = 1500, nodes = false) {
    const nc = await this.connect();
    const found = new Map();
    const inbox = `_INBOX.${crypto.randomUUID().replaceAll('-', '')}`;
    const sub = nc.subscribe(inbox, { callback: (err, msg) => {
      if (err) return;
      try { const info = msg.json(); const id = nodes ? info.nodeId : info.inst; if (id) found.set(id, info); } catch {}
    } });
    try {
      await nc.flush();
      nc.publish(`${this.config.prefix}${nodes ? '.node' : ''}.discover`, '{}', { reply: inbox });
      await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(waitMs, 100), 10000)));
      return [...found.values()];
    } finally { sub.unsubscribe(); }
  }
  async request(inst, kind, payload = {}, timeout = 60000) {
    const nc = await this.connect();
    const subject = subjects(this.config.prefix, inst)[kind];
    if (!subject || !['cmd', 'abort', 'info'].includes(kind)) throw new Error('Geçersiz işlem.');
    return (await nc.request(subject, JSON.stringify(payload), { timeout })).json();
  }
  command(inst, command, timeout = 60000) {
    return this.request(inst, 'cmd', validateCommand({ ...command, id: command.id || crypto.randomUUID() }), timeout);
  }
  async nodeRequest(nodeId, kind, payload = {}) {
    if (!/^[a-zA-Z0-9_-]+$/.test(nodeId) || !['profiles', 'launch'].includes(kind)) throw new Error('Geçersiz node işlemi.');
    return (await (await this.connect()).request(`${this.config.prefix}.node.${kind}.${nodeId}`, JSON.stringify(payload), { timeout: 30000 })).json();
  }
  async close() { if (this.nc) await this.nc.close(); }
}
