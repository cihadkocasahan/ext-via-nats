// Live acceptance: isolated Chrome profile + fixture page, real MCP/NATS/extension.
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { RemoteMeshClient } from './client.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const local = path.join(root, '.local');
await mkdir(local, { recursive: true });
if (!process.env.CHROME_PATH) throw new Error('CHROME_PATH must name an installed Chrome executable.');
const env = { ...process.env, REMOTE_MESH_URL: process.env.REMOTE_MESH_URL || 'ws://127.0.0.1:18222', REMOTE_MESH_PREFIX: process.env.REMOTE_MESH_PREFIX || 'mesh.browser.acceptance' };
const profilePath = path.join(local, 'chrome-live-profile');
const report = { platform: process.platform, at: new Date().toISOString(), checks: [], profilePath };
let broker, context, mcp, transport, nodeAgent;
const control = new RemoteMeshClient(env);
const fixture = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html><meta charset="utf-8"><title>Remote Mesh acceptance</title><style>body{font:18px system-ui;margin:50px;color:#173e43}input,button{padding:12px;margin:10px}</style><h1>Remote Mesh canlı test</h1><label>İsim <input id="name"></label><button id="action">Test düğmesi</button><p id="result">Bekliyor</p><input id="source" value="fixture-private-value"><input id="dest"><script>document.querySelector("#action").onclick=()=>document.querySelector("#result").textContent="Tıklama başarılı";</script></html>');
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${fixture.address().port}/`;
const until = async (fn, budget = 15000) => {
  const end = Date.now() + budget;
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Live acceptance condition timed out');
};
async function tool(name, args) {
  const reply = await mcp.callTool({ name, arguments: args });
  const value = JSON.parse(reply.content[0].text);
  if (reply.isError || value?.ok === false) throw new Error(`${name}: ${JSON.stringify(value)}`);
  return value;
}
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
}
try {
  if (process.env.NATS_SERVER_PATH) {
    const ws = new URL(env.REMOTE_MESH_URL);
    if (ws.hostname !== '127.0.0.1' || ws.protocol !== 'ws:') throw new Error('Managed test broker must use loopback ws.');
    const configFile = path.join(local, 'nats-live.conf');
    await writeFile(configFile, `host: "127.0.0.1"\nport: -1\nwebsocket { host: "127.0.0.1", port: ${Number(ws.port)}, no_tls: true }\n`);
    broker = spawn(process.env.NATS_SERVER_PATH, ['-c', configFile], { stdio: 'ignore', windowsHide: true });
    await new Promise((resolve, reject) => { broker.once('spawn', resolve); broker.once('error', reject); });
  }
  await until(async () => { try { await control.connect(); return true; } catch { return false; } });
  context = await chromium.launchPersistentContext(profilePath, {
    executablePath: process.env.CHROME_PATH, headless: false, viewport: { width: 1100, height: 800 },
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--lang=en-US'],
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const { id: extensionId } = await cdp.send('Extensions.loadUnpacked', { path: path.join(root, 'extension') });
  report.extensionId = extensionId;
  const page = context.pages()[0];
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.locator('input[name=url]').waitFor();
  await until(async () => (await page.locator('input[name=url]').inputValue()).length > 0);
  await page.locator('input[name=url]').fill(env.REMOTE_MESH_URL);
  await page.locator('input[name=prefix]').fill(env.REMOTE_MESH_PREFIX);
  await page.locator('input[name=label]').fill('Debian live acceptance');
  await page.locator('input[name=enabled]').check();
  await page.getByRole('button', { name: 'Kaydet ve bağlan' }).click();
  await page.locator('#status').filter({ hasText: /^Bağlı$/ }).waitFor({ timeout: 15000 });
  report.checks.push('options-ui-and-nats-connection');
  const inst = (await page.locator('#inst').textContent()).replace('Profil kimliği: ', '').trim();
  report.inst = inst;
  const discovered = await control.list(300);
  assert(discovered.some(p => p.inst === inst));
  report.checks.push('profile-discovery');
  mcp = new Client({ name: 'remote-mesh-live-acceptance', version: '1.0.0' });
  transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'scripts/mcp.mjs')], env });
  await mcp.connect(transport);
  const command = steps => tool('remote_mesh_command', { inst, id: crypto.randomUUID(), steps });
  await command([{ v: 'version' }, { v: 'whoami' }]);
  report.checks.push('mcp-version-and-whoami');
  await page.goto(url);
  const tab = { url: url + '*' };
  await command([{ v: 'fill', tab, sel: '#name', literal: 'Remote Mesh' }, { v: 'assert', tab, sel: '#name', eq: 'Remote Mesh' }, { v: 'click', tab, sel: '#action' }, { v: 'assert', tab, sel: '#result', eq: 'Tıklama başarılı' }]);
  assert.equal(await page.locator('#name').inputValue(), 'Remote Mesh');
  assert.equal(await page.locator('#result').textContent(), 'Tıklama başarılı');
  report.checks.push('real-dom-fill-assert-click');
  const moved = await command([{ v: 'relay', from: { tab, sel: '#source' }, to: { tab, sel: '#dest' } }]);
  assert.equal(await page.locator('#dest').inputValue(), 'fixture-private-value');
  assert.equal(JSON.stringify(moved).includes('fixture-private-value'), false);
  report.checks.push('browser-only-value-relay');
  await command([{ v: 'inject', tab, kind: 'button', id: 'mesh-proof', text: 'Mesh çalışıyor', anchor: 'h1' }]);
  assert.equal(await page.locator('#mesh-proof').textContent(), 'Mesh çalışıyor');
  report.checks.push('injected-button');
  // Enable the real Chrome userScripts permission through the extension details UI.
  const details = await context.newPage();
  await details.goto(`chrome://extensions/?id=${extensionId}`);
  await details.locator('extensions-detail-view').waitFor();
  const candidates = await details.locator('extensions-detail-view').locator('cr-toggle').evaluateAll(toggles => toggles.map(t => ({ id: t.id, label: t.getAttribute('aria-label'), text: t.parentElement?.textContent?.trim().slice(0,160) })));
  report.scriptToggles = candidates;
  const scriptsToggle = details.locator('extensions-detail-view').locator('cr-toggle').filter({ visible: true });
  const allToggles = await scriptsToggle.count();
  for (let i = 0; i < allToggles; i++) {
    const toggle = scriptsToggle.nth(i);
    const label = await toggle.evaluate(t => (t.getAttribute('aria-label') || '') + ' ' + (t.parentElement?.textContent || ''));
    if (/user scripts|kullanıcı (?:komut dosy|script)/i.test(label) && await toggle.getAttribute('aria-pressed') !== 'true' && !await toggle.evaluate(t => !!t.checked)) await toggle.click();
  }
  await details.close();
  const info = await tool('remote_mesh_info', { inst });
  const query = await command([{ v: 'query', tab, sel: 'h1' }]);
  assert.equal(query.receipts[0].count, 1);
  // Resolve the exact fixture tab through the extension executor instead of CDP IDs.
  const activated = await command([{ v: 'activate', tab }]);
  const tabId = activated.receipts[0].tabId;
  await tool('remote_mesh_script', { inst, id: crypto.randomUUID(), tab_id: tabId, code: 'document.querySelector("h1").dataset.meshScript="ok";', world: 'USER_SCRIPT' });
  assert.equal(await page.locator('h1').getAttribute('data-mesh-script'), 'ok');
  report.checks.push('real-javascript-user-script');
  const nodeId = 'live-acceptance';
  const nodeConfig = path.join(local, 'live-node.json');
  await writeFile(nodeConfig, JSON.stringify({ nodeId, chromePath: process.env.CHROME_PATH, extensionId, userDataPaths: [profilePath] }));
  nodeAgent = spawn(process.execPath, [path.join(root, 'scripts/node-agent.mjs'), nodeConfig], { env, stdio: 'ignore', windowsHide: true });
  await until(async () => (await control.list(100, true)).some(n => n.nodeId === nodeId));
  const disk = await tool('remote_mesh_disk_profiles', { node_id: nodeId });
  const profile = disk.profiles.find(p => p.directory === 'Default');
  assert(profile);
  const sessionId = crypto.randomUUID();
  await tool('remote_mesh_launch_profile', { node_id: nodeId, profile_id: profile.profileId, request_id: sessionId, apply: true, url });
  await until(async () => {
    const current = await control.request(inst, 'info');
    return current.launch?.run === sessionId && current.launch?.profileId === profile.profileId && current.runs.includes(sessionId);
  });
  report.checks.push('native-profile-launch-and-extension-handshake');
  const closed = await command([{ v: 'close', run: sessionId }]);
  assert.equal(closed.receipts[0].closed.length, 1);
  assert.equal(await page.locator('#name').inputValue(), 'Remote Mesh');
  report.checks.push('owned-window-cleanup-preserves-fixture');
  await page.screenshot({ path: path.join(local, 'chrome-live-proof.png') });
  report.ok = true;
} catch (error) {
  report.ok = false; report.error = error.message;
  if (context) await context.pages()[0]?.screenshot({ path: path.join(local, 'chrome-live-failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await writeFile(path.join(local, 'chrome-live-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await stopChild(nodeAgent);
  await mcp?.close(); await transport?.close();
  await context?.close(); await control.close(); await stopChild(broker);
  await new Promise(resolve => fixture.close(resolve));
}
