import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { ExtViaNatsClient } from '../scripts/client.mjs';
import { VERBS } from '../src/verbs.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const event = () => { const callbacks = []; return { addListener: f => callbacks.push(f), removeListener: f => { const i = callbacks.indexOf(f); if (i >= 0) callbacks.splice(i, 1); }, callbacks }; };
async function until(fn, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('Condition timed out');
}
async function worker(url, id, previous = {}) {
  const data = structuredClone({ ...previous, extViaNatsInst: id, extViaNatsConfig: { enabled: true, url, prefix: 'extvianats.test' } });
  const session = {};
  const timers = new Set();
  const sockets = new Set();
  let writes = 0;
  const storage = store => ({
    get: async key => structuredClone({ [key]: store[key] }),
    set: async obj => { Object.assign(store, structuredClone(obj)); },
    setAccessLevel: async () => {},
  });
  const chrome = {
    storage: { local: storage(data), session: storage(session), onChanged: event() },
    runtime: { getURL: name => `chrome-extension://${'a'.repeat(32)}/${name}`, getManifest: () => ({ version: '0.1.0', permissions: [] }), onMessage: event(), onStartup: event(), onInstalled: event() },
    identity: { getProfileUserInfo: async () => ({ email: `${id}@example.invalid` }) },
    windows: { getAll: async () => [], onCreated: event(), onRemoved: event() },
    tabs: { onRemoved: event(), query: async () => [{ id: 1, windowId: 1 }], get: async () => ({ id: 1, windowId: 1 }),
      sendMessage: async (_id, msg) => { if (msg.op === 'fill') writes++; if (msg.op === 'readRaw') return { ok: true, _v: 'private-fixture' }; return { ok: true, len: 15 }; } },
    action: { onClicked: event() }, alarms: { create() {}, onAlarm: event() },
    userScripts: { execute: async () => [{ frameId: 0, result: 'MUST_NOT_LEAVE_BROWSER' }] },
  };
  const source = await readFile('src/background.js', 'utf8');
  const output = await build({ stdin: { contents: source + '\nexport const shutdown = async () => { generation++; await nc?.close(); };', resolveDir: `${process.cwd()}/src` }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'WorkerTest' });
  const context = vm.createContext({ chrome, console, crypto, TextEncoder, TextDecoder, URL, URLSearchParams, AbortController, queueMicrotask, Uint8Array, ArrayBuffer, DataView,
    WebSocket: class extends WebSocket { constructor(...args) { super(...args); sockets.add(this); } },
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); timers.add(t); return t; }, clearTimeout,
    setInterval: (fn, ms) => { const t = setInterval(fn, ms); timers.add(t); return t; }, clearInterval,
  });
  vm.runInContext(output.outputFiles[0].text, context);
  const stop = async () => { await context.WorkerTest.shutdown(); for (const t of timers) { clearTimeout(t); clearInterval(t); } for (const s of sockets) s.close(); };
  try { await until(() => {
    if (session.extViaNatsStatus?.state === 'error') throw new Error(JSON.stringify(session.extViaNatsStatus));
    return session.extViaNatsStatus?.state === 'connected';
  }); } catch (e) { await stop(); throw e; }
  return { data, session, writes: () => writes, stop };
}
test('real NATS: isolated profiles, receipts, idempotency, abort, restart and MCP', { timeout: 60000 }, async t => {
  const name = `ext-via-nats-test-${process.pid}`;
  const docker = args => {
    const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 20000 });
    if (r.status !== 0) throw new Error(r.stderr || r.error?.message || 'docker failed');
    return r.stdout.trim();
  };
  if (!process.env.TEST_NATS_URL) docker(['run', '-d', '--rm', '--name', name, '-p', '127.0.0.1::8222', '--mount', `type=bind,source=${process.cwd()}/infra/nats-docker.conf,target=/etc/nats/nats.conf,readonly`, 'nats:2.11.9-alpine', '-c', '/etc/nats/nats.conf']);
  let a, b;
  const env = { ...process.env, EXT_VIA_NATS_URL: process.env.TEST_NATS_URL || `ws://127.0.0.1:${docker(['port', name, '8222']).split(':').at(-1)}`, EXT_VIA_NATS_PREFIX: 'extvianats.test' };
  const client = new ExtViaNatsClient(env);
  let mcp, transport;
  try {
    a = await worker(env.EXT_VIA_NATS_URL, 'profile-a');
    b = await worker(env.EXT_VIA_NATS_URL, 'profile-b');
    const list = await client.list(200);
    assert.deepEqual(list.map(p => p.inst).sort(), ['profile-a', 'profile-b']);
    const command = { id: 'fill-1', steps: [{ v: 'fill', tab: { tabId: 1 }, sel: '#field', literal: 'visible text' }] };
    assert.equal((await client.command('profile-a', command)).ok, true);
    assert.equal(a.writes(), 1); assert.equal(b.writes(), 0);
    assert.equal((await client.command('profile-a', command)).ok, true);
    assert.equal(a.writes(), 1);
    assert.equal((await client.command('profile-a', { ...command, follow: true })).code, 'id_conflict');
    const secret = await client.command('profile-a', { id: 'relay-1', steps: [{ v: 'relay', from: { tab: { tabId: 1 }, sel: '#source' }, to: { tab: { tabId: 1 }, sel: '#dest' } }] });
    assert.equal(secret.ok, true); assert.equal(JSON.stringify(secret).includes('private-fixture'), false);
    const script = await client.command('profile-a', { id: 'script-1', steps: [{ v: 'script', tab: { tabId: 1 }, code: 'document.title="test"' }] });
    assert.equal(script.ok, true); assert.equal(JSON.stringify(script).includes('MUST_NOT_LEAVE_BROWSER'), false);
    const run = client.command('profile-a', { id: 'abort-1', steps: [{ v: 'sleep', ms: 500 }, { v: 'fill', tab: { tabId: 1 }, sel: '#field', literal: 'no' }] });
    await until(async () => (await client.request('profile-a', 'info')).running === 'abort-1');
    assert.equal((await client.command('profile-a', { id: 'busy-1', steps: [{ v: 'version' }] })).code, 'busy');
    assert.equal((await client.request('profile-a', 'abort', { id: 'abort-1' })).ok, true);
    assert.equal((await run).aborted, true); assert.equal(a.writes(), 1);
    const previous = a.data;
    await a.stop(); a = await worker(env.EXT_VIA_NATS_URL, 'profile-a', previous);
    assert.equal((await client.command('profile-a', command)).ok, true); assert.equal(a.writes(), 0);
    mcp = new Client({ name: 'test', version: '1.0.0' });
    transport = new StdioClientTransport({ command: process.execPath, args: ['scripts/mcp.mjs'], env });
    await mcp.connect(transport);
    const tools = await mcp.listTools();
    assert.equal(tools.tools.length, 7);
    const names = tools.tools.map(t => t.name).sort();
    assert.deepEqual(names, ['ext_via_nats_abort', 'ext_via_nats_command', 'ext_via_nats_info', 'ext_via_nats_profiles',
      'ext_via_nats_screenshot', 'ext_via_nats_script', 'ext_via_nats_verbs']);
    const response = await mcp.callTool({ name: 'ext_via_nats_command', arguments: { inst: 'profile-b', id: 'mcp-1', steps: [{ v: 'version' }] } });
    assert.equal(JSON.parse(response.content[0].text).ok, true);
    const catalog = JSON.parse((await mcp.callTool({ name: 'ext_via_nats_verbs', arguments: {} })).content[0].text);
    assert.equal(catalog.verbs.length, VERBS.length);
    assert(catalog.verbs.every(v => v.note && v.fields));
    await assert.rejects(client.request('not-running', 'info', {}, 300));
  } finally {
    await mcp?.close(); await transport?.close(); await a?.stop(); await b?.stop(); await client.close();
    if (!process.env.TEST_NATS_URL) docker(['stop', name]);
  }
});
