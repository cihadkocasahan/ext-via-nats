import { wsconnect, credsAuthenticator } from '@nats-io/nats-core';
import { readFile } from 'node:fs/promises';
import { validateConfig, validateCommand, subjects } from '../src/protocol.js';
export class ExtViaNatsClient {
  constructor(env = process.env) {
    this.config = validateConfig({ url: env.EXT_VIA_NATS_URL || 'ws://127.0.0.1:8222', prefix: env.EXT_VIA_NATS_PREFIX || 'extvianats.browser',
      token: env.EXT_VIA_NATS_TOKEN || '', user: env.EXT_VIA_NATS_USER || '', pass: env.EXT_VIA_NATS_PASS || '' });
    this.credsFile = env.EXT_VIA_NATS_CREDS;
  }
  async connect() {
    if (this.nc && !this.nc.isClosed()) return this.nc;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const c = this.config;
      if (this.credsFile && (c.token || c.user || c.pass)) throw new Error('Pick one NATS authentication method.');
      this.nc = await wsconnect({ servers: c.url, timeout: 5000, name: 'ext-via-nats-controller', ignoreServerUpdates: true,
        ...(this.credsFile ? { authenticator: credsAuthenticator(await readFile(this.credsFile)) }
          : c.token ? { token: c.token } : c.user ? { user: c.user, pass: c.pass } : {}) });
      return this.nc;
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
  async list(waitMs = 1500) {
    const nc = await this.connect();
    const found = new Map();
    const inbox = `_INBOX.${crypto.randomUUID().replaceAll('-', '')}`;
    const sub = nc.subscribe(inbox, { callback: (err, msg) => {
      if (err) return;
      try { const info = msg.json(); if (info.inst) found.set(info.inst, info); } catch {}
    } });
    try {
      await nc.flush();
      nc.publish(`${this.config.prefix}.discover`, '{}', { reply: inbox });
      await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(waitMs, 100), 10000)));
      return [...found.values()];
    } finally { sub.unsubscribe(); }
  }
  async request(inst, kind, payload = {}, timeout = 60000) {
    const nc = await this.connect();
    const subject = subjects(this.config.prefix, inst)[kind];
    if (!subject || !['cmd', 'abort', 'info'].includes(kind)) throw new Error('Invalid operation.');
    return (await nc.request(subject, JSON.stringify(payload), { timeout })).json();
  }
  command(inst, command, timeout = 60000) {
    return this.request(inst, 'cmd', validateCommand({ ...command, id: command.id || crypto.randomUUID() }), timeout);
  }
  async close() { if (this.nc) await this.nc.close(); }
}
