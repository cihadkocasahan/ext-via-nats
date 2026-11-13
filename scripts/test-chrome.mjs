// Live acceptance: isolated Chrome profile + fixture page, real MCP/NATS/extension.
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ExtViaNatsClient } from './client.mjs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const local = path.join(root, '.local');
await mkdir(local, { recursive: true });
if (!process.env.CHROME_PATH) throw new Error('CHROME_PATH must name an installed Chrome executable.');
const env = { ...process.env, EXT_VIA_NATS_URL: process.env.EXT_VIA_NATS_URL || 'ws://127.0.0.1:18222', EXT_VIA_NATS_PREFIX: process.env.EXT_VIA_NATS_PREFIX || 'extvianats.browser.acceptance' };
const profilePath = process.env.EXT_VIA_NATS_TEST_PROFILE || path.join(local, 'chrome-live-profile');
const report = { platform: process.platform, at: new Date().toISOString(), checks: [], profilePath };
let broker, context, mcp, transport;
const control = new ExtViaNatsClient(env);
const fixture = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html><meta charset="utf-8"><title>ExtViaNats acceptance</title><style>body{font:18px system-ui;margin:50px;color:#173e43}input,button{padding:12px;margin:10px}</style><h1>ExtViaNats canlı test</h1><label>İsim <input id="name"></label><button id="action">Test düğmesi</button><p id="result">Bekliyor</p><input id="source" value="fixture-private-value"><input id="dest"><script>document.querySelector("#action").onclick=()=>document.querySelector("#result").textContent="Tıklama başarılı";</script></html>');
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
    const ws = new URL(env.EXT_VIA_NATS_URL);
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
  // A retained test profile may already hold identical settings. Force a real
  // disable/enable transition so initial broker startup cannot leave a stale state.
  await page.locator('input[name=enabled]').uncheck();
  await page.locator('#save').click();
  await page.locator('#status[data-state=disabled]').waitFor({ timeout: 15000 });
  await page.locator('input[name=url]').fill(env.EXT_VIA_NATS_URL);
  await page.locator('input[name=prefix]').fill(env.EXT_VIA_NATS_PREFIX);
  await page.locator('input[name=label]').fill(`${process.platform} live acceptance`);
  await page.locator('input[name=enabled]').check();
  await page.locator('#save').click();
  try { await page.locator('#status[data-state=connected]').waitFor({ timeout: 15000 }); }
  catch { throw new Error('Options connection state: ' + await page.locator('#status').textContent()); }
  report.checks.push('options-ui-and-nats-connection');
  const inst = await page.locator('#inst').getAttribute('data-inst');
  report.inst = inst;
  const discovered = await control.list(300);
  assert(discovered.some(p => p.inst === inst));
  report.checks.push('profile-discovery');
  mcp = new Client({ name: 'ext-via-nats-live-acceptance', version: '1.0.0' });
  transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'scripts/mcp.mjs')], env });
  await mcp.connect(transport);
  const command = steps => { report.lastCommand = steps.map(s => s.v); return tool('ext_via_nats_command', { inst, id: crypto.randomUUID(), steps }); };
  await command([{ v: 'version' }, { v: 'whoami' }]);
  report.checks.push('mcp-version-and-whoami');
  await page.goto(url);
  const tab = { url: url + '*' };
  await command([{ v: 'fill', tab, sel: '#name', literal: 'ExtViaNats' }, { v: 'assert', tab, sel: '#name', eq: 'ExtViaNats' }, { v: 'click', tab, sel: '#action' }, { v: 'assert', tab, sel: '#result', eq: 'Tıklama başarılı' }]);
  assert.equal(await page.locator('#name').inputValue(), 'ExtViaNats');
  assert.equal(await page.locator('#result').textContent(), 'Tıklama başarılı');
  report.checks.push('real-dom-fill-assert-click');
  const moved = await command([{ v: 'relay', from: { tab, sel: '#source' }, to: { tab, sel: '#dest' } }]);
  assert.equal(await page.locator('#dest').inputValue(), 'fixture-private-value');
  assert.equal(JSON.stringify(moved).includes('fixture-private-value'), false);
  report.checks.push('browser-only-value-relay');
  await command([{ v: 'inject', tab, kind: 'button', id: 'evn-proof', text: 'ExtViaNats çalışıyor', anchor: 'h1' }]);
  assert.equal(await page.locator('#evn-proof').textContent(), 'ExtViaNats çalışıyor');
  report.checks.push('injected-button');
  // Enable the real Chrome userScripts permission through the extension details UI.
  const details = await context.newPage();
  await details.goto(`chrome://extensions/?id=${extensionId}`);
  await details.locator('extensions-detail-view').waitFor();
  const candidates = await details.locator('extensions-detail-view').locator('cr-toggle').evaluateAll(toggles => toggles.map(t => {
    const owner = t.getRootNode().host;
    return { id: t.id, label: t.getAttribute('aria-label'), owner: owner?.id, text: owner?.textContent?.trim().slice(0,200) };
  }));
  report.scriptToggles = candidates;
  const scriptsToggle = details.locator('extensions-detail-view').locator('cr-toggle').filter({ visible: true });
  const allToggles = await scriptsToggle.count();
  for (let i = 0; i < allToggles; i++) {
    const toggle = scriptsToggle.nth(i);
    const label = await toggle.evaluate(t => { const host = t.getRootNode().host; return [t.getAttribute('aria-label'), host?.id, host?.textContent].join(' '); });
    if (/user.?scripts|kullanıcı.*(?:komut|script)/i.test(label) && !await toggle.evaluate(t => !!t.checked)) await toggle.click();
  }
  await details.close();
  // Granting userScripts already restarts the extension, so no explicit reload is
  // needed — and here it is harmful: chrome.runtime.reload() on a CDP-installed
  // unpacked extension leaves it disabled (options.html then fails with
  // ERR_BLOCKED_BY_CLIENT), because that install is not persisted in the profile.
  // One successful info can still be answered by a worker that is about to die,
  // and a command published in that gap is lost: NATS Core has no offline queue.
  // Require several consecutive answers, spaced out, before issuing more commands.
  let stable = 0;
  const gateStart = Date.now();
  const stableEnd = gateStart + 60000;
  report.reloadTrace = [];
  while (Date.now() < stableEnd && stable < 3) {
    const at = Date.now() - gateStart;
    try {
      const answered = (await control.request(inst, 'info', {}, 2000)).inst === inst;
      stable = answered ? stable + 1 : 0;
      report.reloadTrace.push({ at, ok: answered, stable });
    } catch (e) {
      stable = 0;
      report.reloadTrace.push({ at, ok: false, error: e.message });
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  if (stable < 3) {
    // Ask the browser itself what happened to the extension, instead of guessing
    // from the missing NATS answers: still listed? enabled? what does its own
    // settings page report? An unload and an idle worker look identical on NATS.
    const probe = await context.newPage();
    await probe.goto('chrome://extensions/');
    report.extensionsAfterReload = await probe.evaluate(() => {
      const list = document.querySelector('extensions-manager')?.shadowRoot?.querySelector('extensions-item-list');
      return Array.from(list?.shadowRoot?.querySelectorAll('extensions-item') || []).map(it => ({
        id: it.id,
        name: it.shadowRoot?.querySelector('#name')?.textContent?.trim() || null,
        enabled: it.shadowRoot?.querySelector('#enableToggle')?.getAttribute('aria-pressed') ?? null,
        disableReasons: it.shadowRoot?.querySelector('#disable-reasons')?.textContent?.trim() || null,
      }));
    }).catch(e => ({ error: e.message }));
    report.optionsAfterReload = await probe.goto(`chrome-extension://${extensionId}/options.html`)
      .then(async () => {
        await probe.locator('#status').waitFor({ timeout: 8000 });
        return { state: await probe.locator('#status').getAttribute('data-state'), text: (await probe.locator('#status').textContent()).trim() };
      })
      .catch(e => ({ error: e.message }));
    await probe.close();
    throw new Error('extension did not stay connected after reload');
  }
  const query = await command([{ v: 'query', tab, sel: 'h1' }]);
  assert.equal(query.receipts[0].count, 1);
  // Resolve the exact fixture tab through the extension executor instead of CDP IDs.
  const activated = await command([{ v: 'activate', tab }]);
  const tabId = activated.receipts[0].tabId;
  await tool('ext_via_nats_script', { inst, id: crypto.randomUUID(), tab_id: tabId, code: 'document.querySelector("h1").dataset.evnScript="ok";', world: 'USER_SCRIPT' });
  assert.equal(await page.locator('h1').getAttribute('data-evn-script'), 'ok');
  report.checks.push('real-javascript-user-script');
  // Ownership without a launcher: open a marked window, read the marker back
  // through info, then close only that window. The fixture tab lives in the
  // operator's own window and must survive the cleanup.
  const runTag = crypto.randomUUID();
  const opened = await command([{ v: 'openWindow', url, run: runTag }]).catch(async e => {
    // Distinguish "worker is gone" from "worker is alive but this verb hung".
    report.openWindowProbe = await control.request(inst, 'info', {}, 8000)
      .then(i => ({ alive: true, running: i.running, windows: i.windows, runs: i.runs }))
      .catch(x => ({ alive: false, error: x.message }));
    throw e;
  });
  assert.equal(opened.receipts[0].marked, true);
  await until(async () => (await control.request(inst, 'info')).runs.includes(runTag));
  report.checks.push('owned-window-marker');
  const closed = await command([{ v: 'close', run: runTag }]);
  assert.equal(closed.receipts[0].closed.length, 1);
  assert.equal(closed.receipts[0].leftRunning.length, 0);
  assert.equal(await page.locator('#name').inputValue(), 'ExtViaNats');
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
  await mcp?.close(); await transport?.close();
  await context?.close(); await control.close(); await stopChild(broker);
  await new Promise(resolve => fixture.close(resolve));
}
