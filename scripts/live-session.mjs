// Opens an isolated, visible Chrome session. Site navigation goes through MCP/NATS.
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { RemoteMeshClient } from './client.mjs';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const local = path.join(root, '.local');
await mkdir(local, { recursive: true });
const target = new URL(process.argv[2] || 'https://example.com');
if (!['https:', 'http:'].includes(target.protocol)) throw new Error('HTTP(S) URL required.');
if (!process.env.CHROME_PATH || !process.env.NATS_SERVER_PATH) throw new Error('CHROME_PATH and NATS_SERVER_PATH required for this local demo.');
const env = { ...process.env, REMOTE_MESH_URL: 'ws://127.0.0.1:18223', REMOTE_MESH_PREFIX: 'mesh.browser.demo' };
let broker, context, mcp, transport;
const client = new RemoteMeshClient(env);
const reportFile = path.join(local, 'live-session.json');
const report = { state: 'starting', url: target.href, pid: process.pid };
const save = async () => { await writeFile(reportFile, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); };
const until = async fn => {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Session startup timed out');
};
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  await mcp?.close(); await transport?.close(); await context?.close(); await client.close();
  if (broker && broker.exitCode === null) broker.kill();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop().finally(() => process.exit(0)); });
try {
  const config = path.join(local, 'nats-demo.conf');
  await writeFile(config, 'host: "127.0.0.1"\nport: -1\nwebsocket { host: "127.0.0.1", port: 18223, no_tls: true }\n');
  broker = spawn(process.env.NATS_SERVER_PATH, ['-c', config], { stdio: 'ignore' });
  await until(async () => { try { await client.connect(); return true; } catch { return false; } });
  context = await chromium.launchPersistentContext(path.join(local, 'chrome-demo-profile'), {
    executablePath: process.env.CHROME_PATH, headless: false, viewport: { width: 1100, height: 800 },
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const { id: extensionId } = await cdp.send('Extensions.loadUnpacked', { path: path.join(root, 'extension') });
  const settings = context.pages()[0];
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  await until(async () => (await settings.locator('input[name=url]').inputValue()).length > 0);
  await settings.locator('input[name=enabled]').uncheck();
  await settings.getByRole('button', { name: 'Kaydet ve bağlan' }).click();
  await settings.locator('#status').filter({ hasText: /^Bağlantı kapalı$/ }).waitFor();
  await settings.locator('input[name=url]').fill(env.REMOTE_MESH_URL);
  await settings.locator('input[name=prefix]').fill(env.REMOTE_MESH_PREFIX);
  await settings.locator('input[name=label]').fill('Debian MCP live demo');
  await settings.locator('input[name=enabled]').check();
  await settings.getByRole('button', { name: 'Kaydet ve bağlan' }).click();
  await settings.locator('#status').filter({ hasText: /^Bağlı$/ }).waitFor({ timeout: 15000 });
  const inst = (await settings.locator('#inst').textContent()).replace('Profil kimliği: ', '').trim();
  report.inst = inst; report.extensionId = extensionId;
  mcp = new Client({ name: 'remote-mesh-live-demo', version: '1.0.0' });
  transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'scripts/mcp.mjs')], env });
  await mcp.connect(transport);
  const opened = context.waitForEvent('page');
  const result = await mcp.callTool({ name: 'remote_mesh_command', arguments: { inst, id: crypto.randomUUID(), steps: [{ v: 'openTab', url: target.href, active: true, requireLoaded: false, loadTimeout: 15000 }] } });
  const value = JSON.parse(result.content[0].text);
  if (result.isError || !value.ok) throw new Error(JSON.stringify(value));
  const page = await opened;
  report.state = 'open'; report.receipt = value; report.actualUrl = page.url(); report.title = await page.title();
  report.visibleText = (await page.locator('body').innerText()).slice(0, 1500);
  await page.screenshot({ path: path.join(local, 'live-session.png') });
  await save();
  await context.waitForEvent('close', { timeout: 0 });
} catch (e) {
  report.state = 'error'; report.error = e.message; await save(); process.exitCode = 1;
} finally { await stop(); }
