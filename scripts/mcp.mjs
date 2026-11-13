import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ExtViaNatsClient } from './client.mjs';
import { VERBS, GROUPS, VERB_NAMES, FAIL_CODES } from '../src/verbs.js';
const client = new ExtViaNatsClient();
const server = new McpServer({ name: 'ext-via-nats', version: '0.1.0' });
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError: value?.ok === false });
const safe = fn => async args => {
  try { return result(await fn(args)); }
  catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
};
server.registerTool('ext_via_nats_verbs', {
  description: 'Return the browser verb catalog: every v value, its fields, its group, and which verbs deliberately return page data. Also returns the stable failure codes a receipt can carry, so a caller can branch on retry-vs-human instead of parsing prose. Call this before composing steps.',
  inputSchema: { group: z.enum(Object.keys(GROUPS)).optional(), verb: z.string().optional() },
  annotations: { readOnlyHint: true },
}, safe(({ group, verb }) => ({
  ok: true,
  groups: GROUPS,
  verbs: VERBS.filter(x => (!group || x.group === group) && (!verb || x.v === verb)),
  failCodes: FAIL_CODES,
  targeting: {
    tab: '{tabId:123} or {url:"https://example.com/*", title?, index?}',
    sel: 'CSS, text=…, [textContent="…"], XPath, or a | fallback chain; last= picks the last match',
    frameId: 'optional; defaults to 0 (top frame). Run v:"frames" to list cross-origin iframes',
  },
})));
server.registerTool('ext_via_nats_screenshot', {
  description: 'Capture the visible area of a tab as an image, downscaled in the extension so it fits a NATS payload. Returns the image plus a receipt (bytes, format, tabId). A background tab must be raised first, so this is refused when the command runs with dnd. Pixels are page data: they can contain anything on screen.',
  inputSchema: {
    inst: z.string(), tab_id: z.number().int().optional(), url: z.string().optional(),
    format: z.enum(['jpeg', 'png']).optional(), quality: z.number().min(10).max(100).optional(),
    max_width: z.number().min(160).max(3840).optional(), id: z.string().optional(),
  },
  annotations: { destructiveHint: false, openWorldHint: true },
}, async ({ inst, tab_id, url, format, quality, max_width, id }) => {
  try {
    if (tab_id == null && !url) throw new Error('tab_id or url is required.');
    const tab = tab_id != null ? { tabId: tab_id } : { url };
    const res = await client.command(inst, { id: id || crypto.randomUUID(),
      steps: [{ v: 'screenshot', tab, format, quality, maxWidth: max_width }] });
    const r = res.receipts?.[0];
    const m = r?.dataUrl && /^data:([^;]+);base64,(.+)$/.exec(r.dataUrl);
    if (!res.ok || !m) return result(res);
    const { dataUrl, ...meta } = r;
    return { content: [
      { type: 'text', text: JSON.stringify({ ok: true, id: res.id, inst: res.inst, receipt: meta }, null, 2) },
      { type: 'image', data: m[2], mimeType: m[1] },
    ] };
  } catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
});
server.registerTool('ext_via_nats_script', {
  description: 'Run user-authorised JavaScript in one exact profile and tab through Chrome userScripts (Chrome 135+, user-script permission enabled in the extension details). It can change the DOM and page behaviour. Return values are never sent over NATS: only the execution result and frame count come back. Prefer a named verb when one exists.',
  inputSchema: { inst: z.string(), id: z.string(), tab_id: z.number().int(), code: z.string().min(1).max(100000), world: z.enum(['USER_SCRIPT', 'MAIN']).default('USER_SCRIPT') },
  annotations: { destructiveHint: true, openWorldHint: true },
}, safe(({ inst, id, tab_id, code, world }) => client.command(inst, { id, steps: [{ v: 'script', tab: { tabId: tab_id }, code, world }] })));
server.registerTool('ext_via_nats_profiles', { description: 'List the Chrome profiles whose ExtViaNats extension is connected to this NATS account, with their exact inst ids. An inst is a per-profile UUID, not an email address or a profile folder name. Discovery is a live request/reply, so a closed profile simply does not answer.', inputSchema: { wait_ms: z.number().min(100).max(10000).optional() }, annotations: { readOnlyHint: true } },
  safe(({ wait_ms }) => client.list(wait_ms)));
server.registerTool('ext_via_nats_info', { description: 'Read one profile session: windows, tab count, which windows this extension opened (owned), their run tags, and the command currently running. Read-only.', inputSchema: { inst: z.string() }, annotations: { readOnlyHint: true } },
  safe(({ inst }) => client.request(inst, 'info')));
server.registerTool('ext_via_nats_command', {
  description: `Run browser steps in one exact profile. Verbs: ${VERB_NAMES.join(', ')}. Call ext_via_nats_verbs for fields and semantics. Target a tab with tab:{url:"https://example.com/*"} or tab:{tabId:123}, and a frame with frameId (default 0 = top frame; v:"frames" lists them, including cross-origin iframes). Selectors accept CSS, text=…, XPath and a | fallback chain. fill takes literals only; relay/move/swap carry values browser-side and report length, never the value. dnd:true refuses screen takeovers and opens windows minimised; follow:true makes every touched tab visible so a human can watch. One command per profile at a time (busy / in_progress). The last 100 command ids are remembered: the same id with the same content returns the stored result, changed content returns id_conflict. On timeout, re-query with the SAME id instead of retrying blind. Get the user's explicit approval before submitting, deleting, purchasing or sending anything.`,
  inputSchema: { inst: z.string(), id: z.string().optional(), steps: z.array(z.record(z.string(), z.unknown())).min(1).max(200), dnd: z.boolean().optional(), follow: z.boolean().optional(), onError: z.enum(['halt', 'continue']).optional(), timeout_ms: z.number().min(1000).max(240000).optional() },
  annotations: { destructiveHint: true, openWorldHint: true },
}, safe(({ inst, timeout_ms, ...command }) => client.command(inst, command, timeout_ms)));
server.registerTool('ext_via_nats_abort', { description: 'Stop the running command with this exact id at the next step boundary. Cleanup steps (close, closeTab) still run. It does not interrupt a page script that is already executing.', inputSchema: { inst: z.string(), id: z.string() }, annotations: { destructiveHint: false } },
  safe(({ inst, id }) => client.request(inst, 'abort', { id })));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void client.close().finally(() => process.exit(0)); });
await server.connect(new StdioServerTransport());
