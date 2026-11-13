// executor.js — browser verb executor for the MV3 service worker.
// Commands arrive over NATS request/reply (see background.js), run across tabs
// and frames, and answer with NON-SECRET receipts. Raw values (_v) travel only
// in this worker's memory between tabs; they are never serialized out.
// Each step also streams a redacted HUD line to the affected tab.

const BUILD = 'ext-via-nats-0.1.0';
let transport = { announce() {} };

// Provenance marker. `inst` identifies a PROFILE, not a window, so it cannot
// answer "did we open this one" — and it must not: the operator may open any
// number of windows in a profile we are installed in, before or after us.
// Instead every window we open carries a tab of our own extension page tagged
// with the run that asked for it. Ownership is read off the tab, not off a
// timestamp, so it survives a service-worker restart, a browser restart and an
// operator closing the window by hand.
const HARNESS = chrome.runtime.getURL('harness.html');



// Per-command: when cmd.follow is true, every tab the relay touches becomes the
// visible tab, so a human can watch the run. Off by default — a background
// automation must never hijack the window the operator is using.
let followTabs = false;

// Per-command: cmd.dnd is the caller's promise that this run must not touch the
// screen. Enforced here, not left to the playbook author's good intentions: a
// verb whose entire job is to raise a surface refuses with `dnd_refused`, and a
// verb that can do its job either way is downgraded and says so in its receipt.
// `follow` loses outright — watch-me never outranks don't-disturb.
let dndMode = false;

// the anchor tab opened by the `hub` verb; cleared if the operator closes it
let hubTabId = null;

// Chrome's own new-tab page. Used as the lifecycle anchor because it is a real
// page Chrome opens by default and it is addressable by url matcher.
const NTP = 'chrome://newtab/';

// This worker's identity. The controller dispatches on it, so a command can no
// longer land in "whichever profile happened to answer first" — the silent
// multi-profile lottery. It is deliberately NOT the profile name (an extension
// cannot read that); it is a stable handle for exactly one running profile.
let inst = null;
const instReady = (async () => {
  try {
    const got = await chrome.storage.local.get('extViaNatsInst');
    if (got && typeof got.extViaNatsInst === 'string' && got.extViaNatsInst) { inst = got.extViaNatsInst; return; }
    inst = crypto.randomUUID();
    await chrome.storage.local.set({ extViaNatsInst: inst });
  } catch (_) { inst = 'anon-' + Math.random().toString(36).slice(2, 10); }
})();

// the command this worker is running right now, and the operator's stop request
let runningId = null;
let abortFlag = false;

// Free-text failure reasons are not machine-readable, and an agent sitting on
// an MCP endpoint has to branch on them (retry vs hand off to a human). Map the
// verbs' prose onto a small stable code set instead of rewriting every verb.
const FAIL_CODES = [
  [/^no tab with id/, 'no_tab_id'],
  [/^no tab for/, 'no_tab'],
  [/no element|not found$/, 'element_not_found'],
  [/Cannot access contents of|The extensions gallery cannot be scripted|cannot be scripted/, 'page_not_scriptable'],
  [/No frame with id|frame was removed/, 'no_frame'],
  // a playbook that names a tab by an invalid match pattern (an IP host with a
  // `*://` scheme, a missing path) fails in Chrome's own words; that is an
  // authoring bug, not a page state, so it needs its own code to branch on
  [/Invalid url pattern|Invalid match pattern/, 'bad_matcher'],
  [/element present/, 'assert_failed'],
  [/did not finish loading|did not start/, 'page_not_loaded'],
  [/unknown verb|unknown op/, 'unknown_verb'],
  [/timeout/, 'timed_out'],
  [/no value|empty/, 'field_empty'],
  // a worker profile launched with --no-startup-window has no window to put a
  // tab in; the caller must openWindow first rather than guess at a tab
  [/No current window/, 'no_window'],
];
function codeFor(msg) {
  const s = String(msg || '');
  for (const [re, code] of FAIL_CODES) if (re.test(s)) return code;
  return 'failed';
}

// ── session inventory: what is open, and which of it is ours ──────
function runTag(url) {
  try { return new URL(url).searchParams.get('run') || 'unmarked'; } catch (_) { return 'unmarked'; }
}

async function inventory() {
  const wins = await chrome.windows.getAll({ populate: true });
  const runs = {};
  const ours = [];
  let tabs = 0;
  for (const w of wins) {
    const list = w.tabs || [];
    tabs += list.length;
    for (const t of list) {
      if (typeof t.url === 'string' && t.url.startsWith(HARNESS)) {
        const r = runTag(t.url);
        (runs[r] || (runs[r] = [])).push(w.id);
        if (!ours.includes(w.id)) ours.push(w.id);
      }
    }
  }
  return { wins, tabs, runs, ours };
}

// Receipts carry a page ADDRESS, never its query string: a signed media URL,
// an OAuth `code` or a reset token lives in the query, and a receipt is what an
// MCP client logs. Origin + path is enough to identify a page or a frame.
function safeUrl(u) {
  try { const x = new URL(String(u)); return x.origin + x.pathname; } catch (_) { return null; }
}

// Receipt budget for an inline image. NATS Core has no offline queue and the
// broker silently drops an oversized publish, so a screenshot is downscaled in
// the worker and refused above this size instead of vanishing into a timeout.
const MAX_IMAGE_BYTES = 700 * 1024;

async function shrinkImage(dataUrl, maxWidth, format, quality) {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxWidth / bmp.width);
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const out = await canvas.convertToBlob({ type: format === 'png' ? 'image/png' : 'image/jpeg', quality: quality / 100 });
  const buf = new Uint8Array(await out.arrayBuffer());
  let bin = '';
  for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000));
  return `data:${out.type};base64,${btoa(bin)}`;
}

async function sessionInfo() {
  const m = chrome.runtime.getManifest();
  const inv = await inventory();
  return {
    inst, ver: m.version, build: BUILD, tabs: inv.tabs,
    windows: inv.wins.map(w => ({ id: w.id, type: w.type, state: w.state, focused: !!w.focused, tabs: (w.tabs || []).length })),
    ours: inv.ours, runs: Object.keys(inv.runs),
  };
}

// Dedupe on the CONTENT of the snapshot, not the clock. Chrome applies a
// window create/remove asynchronously, so a hello fired straight after the
// call often describes the previous state — a time-based debounce then
// swallows the corrected follow-up and the registry is left advertising a
// window that is already closed. Signature-based: same → skip, changed → send.
let helloSig = '';
function helloChanged(info) {
  const sig = JSON.stringify([info.tabs, info.windows, info.ours, info.runs]);
  if (sig === helloSig) return false;
  helloSig = sig;
  return true;
}

async function hello(force) {
  const info = await sessionInfo();
  if (!force && !helloChanged(info)) return null;
  transport.announce(info);
  return info;
}

// Window mutation: announce the state we can see now, then announce again once
// the browser has settled. The second call is what makes `ours`/`runs` real.
function helloSoon() {
  hello().catch(() => {});
  setTimeout(() => { hello().catch(() => {}); }, 700);
  setTimeout(() => { hello().catch(() => {}); }, 2500);
}

async function noteTab(t) {
  if (!followTabs || !t) return;
  try {
    if (!t.active) await chrome.tabs.update(t.id, { active: true });
    if (t.windowId != null) await chrome.windows.update(t.windowId, { focused: true });
  } catch (_) {}
}

async function tabFor(match) {
  if (!match) throw new Error('no tab matcher');
  // tabId is the only way to address privileged pages (chrome://, devtools),
  // which chrome.tabs.query's url filter refuses to match.
  if (match.tabId) {
    const t = await chrome.tabs.get(match.tabId).catch(() => null);
    if (!t) throw new Error('no tab with id ' + match.tabId);
    await noteTab(t);
    return t;
  }
  const q = {};
  if (match.url) q.url = Array.isArray(match.url) ? match.url : [match.url];
  if (match.title) q.title = match.title;
  const tabs = await chrome.tabs.query(q);
  if (!tabs.length) throw new Error('no tab for ' + JSON.stringify(match));
  // newest first: when several tabs match, the one this run just opened is the
  // right target — closing/typing into an older look-alike tab is how a
  // background run ends up damaging the operator's own tab
  tabs.sort((a, b) => b.id - a.id);
  const idx = match.index || 0;
  const t = tabs[Math.min(idx, tabs.length - 1)];
  await noteTab(t);
  return t;
}

// Blocks until the tab reports a given chrome.tabs status (or the budget runs
// out). Playbooks must not gate on a blind `settle` sleep: slow pages are the
// main source of false failures, so loading is a verb-level guarantee.
function waitStatus(tabId, status, budget) {
  return new Promise(resolve => {
    let settled = false;
    const finish = got => {
      if (settled) return; settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(to);
      resolve(got);
    };
    const onUpdated = (id, info) => { if (id === tabId && info.status === status) finish(status); };
    const to = setTimeout(() => finish('timeout'), budget || 20000);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(t => { if (t && t.status === status) finish(status); }).catch(() => finish('gone'));
  });
}

// Frame addressing is explicit. Without a frameId Chrome delivers a tab message
// to EVERY frame and answers with whichever replies first, so a selector that
// exists in two frames is a lottery. Default is the top frame (0); `frameId`
// names one frame, including a cross-origin one — content.js is injected into
// all frames, so an iframe is addressable without a debugger attachment.
async function send(tab, msg, frameId = 0) {
  const opts = { frameId };
  try {
    return await chrome.tabs.sendMessage(tab.id, msg, opts);
  } catch (e) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frameId] }, files: ['content.js'] });
    return chrome.tabs.sendMessage(tab.id, msg, opts);
  }
}

// best-effort HUD push; routes through send() so content.js is injected on
// demand if the tab predates the extension (otherwise first pushes are lost).
async function hud(tab, line) {
  try { await send(tab, { op: 'hud', line }); } catch (_) {}
}

function strip(res, v, i) {
  const r = { i, v, ok: !!(res && res.ok) };
  if (res && res.error) r.error = res.error;
  if (res && typeof res.len === 'number') r.len = res.len;
  if (res && res.code) r.code = res.code;
  return r;
}

// Verbs whose whole job is one content-script op. The step's own fields are
// forwarded by name, so the wire contract and the DOM contract cannot drift.
const CONTENT_OPS = {
  hover: ['sel'],
  dblclick: ['sel'],
  rightClick: ['sel'],
  highlight: ['sel', 'color', 'ms'],
  mouseDrag: ['sel', 'dx', 'dy', 'moves'],
  select: ['sel', 'value', 'label', 'index'],
  scroll: ['sel', 'align', 'x', 'y', 'byX', 'byY'],
  getText: ['sel', 'max'],
  getHTML: ['sel', 'outer', 'max'],
  media: ['sel', 'action', 'value'],
  uploadFile: ['sel', 'name', 'mime', 'text', 'url', 'dataUrl'],
};
// Result fields a receipt may carry back. Page text/markup is opt-in egress
// (the caller asked for it); everything else is shape, count or state.
const OP_FIELDS = {
  hover: ['hit'], dblclick: ['hit'], rightClick: ['hit'], highlight: ['hit'],
  mouseDrag: ['from', 'to'], select: ['index', 'count'], scroll: ['mode', 'x', 'y', 'maxY', 'box'],
  getText: ['text', 'truncated'], getHTML: ['html', 'truncated'],
  media: ['action', 'paused', 'muted', 'volume', 'rate', 'currentTime', 'duration', 'ended', 'readyState', 'src'],
  uploadFile: ['name', 'bytes', 'via', 'setFiles', 'dropped'],
};

async function runStep(step, i, id) {
  const run = (tab, sel) => tab && hud(tab, { id, i, v: step.v, sel, phase: 'run' });
  const done = (tab, sel, r) => tab && hud(tab, Object.assign({ id, i, v: step.v, sel }, r));
  const fid = Number.isInteger(step.frameId) ? step.frameId : 0;
  const send$ = (tab, msg, f = fid) => send(tab, msg, f);
  if (CONTENT_OPS[step.v]) {
    const tab = await tabFor(step.tab); run(tab, step.sel);
    const msg = { op: step.v };
    for (const k of CONTENT_OPS[step.v]) if (step[k] !== undefined) msg[k] = step[k];
    const res = await send$(tab, msg);
    const r = strip(res, step.v, i);
    for (const k of OP_FIELDS[step.v] || []) if (res && res[k] !== undefined) r[k] = res[k];
    done(tab, step.sel, r); return r;
  }
  switch (step.v) {
    case 'script': {
      if (!chrome.userScripts?.execute) return { i, v: 'script', ok: false, code: 'user_scripts_unavailable', error: 'Chrome 135+ ve eklenti ayrıntılarında kullanıcı script izni gerekir.' };
      if (typeof step.code !== 'string' || !step.code || step.code.length > 100000) return { i, v: 'script', ok: false, code: 'invalid_script' };
      const tab = await tabFor(step.tab);
      const results = await chrome.userScripts.execute({ target: { tabId: tab.id }, js: [{ code: step.code }], world: step.world === 'MAIN' ? 'MAIN' : 'USER_SCRIPT' });
      // Do not serialize arbitrary script return values into NATS/history.
      return { i, v: 'script', ok: results.every(r => !r.error), frames: results.length, code: results.some(r => r.error) ? 'script_error' : undefined };
    }
    case 'sleep':
      await new Promise(x => setTimeout(x, Math.min(step.ms || 500, 20000)));
      return { i, v: 'sleep', ok: true };

    case 'version': { // probe: proves whether the running SW loaded THIS file
      // ver+build prove the code; desc+perms prove the MANIFEST, which Chrome
      // also only re-reads on reload — a description or permission edit is
      // otherwise invisible to receipts and looks like it never took effect
      const m = chrome.runtime.getManifest();
      return { i, v: 'version', ok: true, ver: m.version, build: BUILD, inst,
        desc: m.description, perms: m.permissions };
    }

    case 'whoami': {
      const info = await sessionInfo();
      return Object.assign({ i, v: 'whoami', ok: true }, info);
    }

    case 'openWindow': {
      // A window we open is a window we may close: the second url is our own
      // harness page tagged with this run, and it is what `close` reads back.
      const run = step.run || id || 'unmarked';
      const urls = [step.url || NTP, HARNESS + '?run=' + encodeURIComponent(run)];
      const opts = { url: urls, focused: step.focused === true && !dndMode };
      // Geometry is parametric: a step may pin the window (width/height/left/
      // top) when it needs more than the default. Absent that, the size is left
      // to Chrome, which opens a new window at the size of the current one — so
      // a launch that came up half-screen yields half-screen windows here too.
      for (const k of ['width', 'height', 'left', 'top']) {
        if (Number.isFinite(step[k])) opts[k] = step[k];
      }
      // focused:false is NOT hidden: measured on 157, an unfocused window is
      // still on screen (IsWindowVisible=1). So under DND a window we open is
      // opened minimised unless the caller named a state — an explicit state
      // is the caller overriding us, and says so in the receipt.
      const wantState = step.state || (dndMode ? 'minimized' : null);
      if (wantState) opts.state = wantState;
      const w = await chrome.windows.create(opts);
      // chrome.windows.create() accepts `state` and quietly ignores
      // "minimized" (measured: OS IsIconic=0, the window is on screen), so the
      // state has to be applied afterwards to really stay out of the way.
      let state = w.state;
      if (wantState && wantState !== state) {
        try { state = (await chrome.windows.update(w.id, { state: wantState })).state; }
        catch (e) { state = 'update failed: ' + String((e && e.message) || e); }
      }
      // The marker tab is what authorises a later `close`, and a freshly
      // created window does not always report its urls yet. Confirm the mark
      // landed; an unmarked window is one we could open but never close.
      let marked = false;
      for (let t = 0; t < 12 && !marked; t++) {
        const inv2 = await inventory();
        marked = (inv2.runs[run] || []).includes(w.id);
        if (!marked) await new Promise(r => setTimeout(r, 250));
      }
      helloSoon();
      const downgraded = [];
      if (dndMode && step.focused === true) downgraded.push('focused forced off');
      if (dndMode && !step.state) downgraded.push('state forced minimized');
      return { i, v: 'openWindow', ok: marked, marked, state, windowId: w.id,
        tabs: (w.tabs || []).length, run,
        dndDowngraded: downgraded.length ? downgraded.join(', ') : undefined,
        error: marked ? undefined : 'marker tab not visible in window' };
    }

    case 'close': {
      // Only windows carrying our marker. Anything the operator opened in this
      // same profile — before us, after us, or beside us — is not in `ours` and
      // is reported as untouched, never closed.
      const inv = await inventory();
      const wanted = step.run ? (inv.runs[step.run] || []) : inv.ours;
      const closed = [], gone = [], refused = [];
      for (const wid of wanted) {
        if (!inv.wins.some(w => w.id === wid)) { gone.push(wid); continue; }
        try { await chrome.windows.remove(wid); closed.push(wid); }
        catch (e) { refused.push({ id: wid, error: String((e && e.message) || e) }); }
      }
      const untouched = inv.wins.filter(w => !wanted.includes(w.id)).map(w => w.id);
      // chrome.windows.remove() resolves before the window is really gone, so a
      // receipt sent straight away can describe a window that still exists.
      // Poll until the closed ids disappear: `leftRunning` is the honest answer.
      let leftRunning = [];
      for (let t = 0; t < 12; t++) {
        const inv2 = await inventory();
        leftRunning = closed.filter(wid => inv2.wins.some(w => w.id === wid));
        if (!leftRunning.length) break;
        await new Promise(r => setTimeout(r, 250));
      }
      helloSoon();
      return { i, v: 'close', ok: refused.length === 0 && leftRunning.length === 0,
        closed, gone, refused, untouched, leftRunning,
        error: refused.length ? 'window refused to close'
          : leftRunning.length ? 'window still running after close' : undefined };
    }

    case 'reload': { // re-read background.js from disk so future edits apply without a browser restart
      setTimeout(() => { try { chrome.runtime.reload(); } catch (_) {} }, 250);
      return { i, v: 'reload', ok: true, note: 'reloading extension from disk' };
    }

    case 'navigate': {
      const tab = await tabFor(step.tab); run(tab, step.url);
      await chrome.tabs.update(tab.id, { url: step.url });
      // wait for the navigation to actually start first, otherwise a stale
      // 'complete' from the previous document fast-paths instantly
      const started = await waitStatus(tab.id, 'loading', 5000);
      const loaded = await waitStatus(tab.id, 'complete', step.loadTimeout);
      if (step.settle) await new Promise(x => setTimeout(x, step.settle));
      const r = { i, v: 'navigate', ok: true, loaded, started: started === 'loading' };
      if (loaded !== 'complete' && step.requireLoaded !== false) r.ok = false, r.error = 'page did not finish loading (' + loaded + ')';
      done(tab, step.url, r); return r;
    }
    case 'waitFor': {
      const tab = await tabFor(step.tab); run(tab, step.sel);
      const res = await send$(tab, { op: 'waitFor', sel: step.sel, timeout: step.timeout, grow: !!step.grow, quiet: step.quiet });
      const r = strip(res, 'waitFor', i);
      if (res && typeof res.count === 'number') r.count = res.count;
      done(tab, step.sel, r); return r;
    }
    case 'click': {
      const tab = await tabFor(step.tab); run(tab, step.sel);
      const res = await send$(tab, { op: 'click', sel: step.sel });
      const r = strip(res, 'click', i);
      if (res && res.hit) r.hit = res.hit;
      done(tab, step.sel, r); return r;
    }
    case 'captcha': {
      // The human gate. Detects, warns on screen, and — with wait:true — blocks
      // until the operator solves it, so the run resumes by itself instead of
      // needing someone to tell the agent "I did it". Budget stays under the
      // 60s content-script ceiling; a longer challenge needs another step.
      const tab = await tabFor(step.tab); run(tab, null);
      const res = await send$(tab, { op: 'captcha', wait: !!step.wait, timeout: step.timeout });
      const r = strip(res, 'captcha', i);
      if (res) {
        r.present = !!res.present;
        if (res.kind) r.kind = res.kind;
        if (typeof res.waitedMs === 'number') r.waitedMs = res.waitedMs;
      }
      if (step.wait && r.ok === false && !r.code) r.code = 'captcha_unsolved';
      done(tab, null, r); return r;
    }
    case 'fill': {
      // `fill` is the literal verb: labels, usernames, search terms. A secret
      // reference is refused rather than resolved — this build has no secret
      // store, and a value that must not be read by the agent should be moved
      // browser-to-browser with relay/move/swap instead of named in a command.
      if (typeof step.secret === 'string' && step.secret) {
        return { i, v: 'fill', ok: false, code: 'secret_ref_unsupported',
          error: 'fill takes literals only; use relay/move/swap to carry a value between fields' };
      }
      const tab = await tabFor(step.tab); run(tab, step.sel);
      const res = await send$(tab, { op: 'fill', sel: step.sel, literal: step.literal });
      const r = strip(res, 'fill', i); done(tab, step.sel, r); return r;
    }
    case 'assert': {
      const tab = await tabFor(step.tab); run(tab, step.sel);
      const res = await send$(tab, { op: 'assert', sel: step.sel, has: step.has, eq: step.eq, absent: step.absent });
      const r = strip(res, 'assert', i);
      // a value mismatch arrives as ok:false with no prose at all, which mapped
      // to the opaque `failed` code; an agent must be able to tell "wrong text"
      // from "my matcher was broken"
      if (!r.ok && !r.error) { r.code = 'assert_failed'; r.error = 'assert: value mismatch'; }
      done(tab, step.sel, r); return r;
    }
    case 'query': {
      // Discovery, not verification: this is the only verb that answers with
      // page structure (tag/id/class/box/vis/len) instead of a pass/fail. It
      // exists because every selector in a playbook used to be a guess paid for
      // in round-trips. Page text is opt-in (`text:true`) and withheld for
      // fields, so a discovery step cannot become a value-read.
      const tab = await tabFor(step.tab); run(tab, step.sel);
      const res = await send$(tab, { op: 'query', sel: step.sel, limit: step.limit, text: step.text === true });
      const r = strip(res, 'query', i);
      if (res && typeof res.count === 'number') r.count = res.count;
      if (res && typeof res.shown === 'number') r.shown = res.shown;
      if (res && res.items) r.items = res.items;
      done(tab, step.sel, r); return r;
    }
    case 'clear': { // actively wipe a field (e.g. a relayed secret) so nothing lingers
      const tab = await tabFor(step.tab); run(tab, step.sel);
      const res = await send$(tab, { op: 'clearRaw', sel: step.sel });
      const r = { i, v: 'clear', ok: !!(res && res.ok) }; done(tab, step.sel, r); return r;
    }
    case 'setStore': {
      // The write side of `readRaw`'s store grammar. A step can now end a
      // browser session from the outside: localStorage:KEY / sessionStorage:KEY
      // / cookie:NAME, `remove:true` to delete, `*` for the whole store. The
      // receipt answers with counts (cleared / left), so a run can prove it
      // wiped something without any value passing through.
      const tab = await tabFor(step.tab); run(tab, step.sel);
      const res = await send$(tab, { op: 'setStore', sel: step.sel, value: step.value, remove: step.remove === true });
      const r = strip(res, 'setStore', i);
      if (res && typeof res.cleared === 'number') r.cleared = res.cleared;
      if (res && typeof res.left === 'number') r.left = res.left;
      if (!r.ok && res && res.code) r.code = res.code;
      done(tab, step.sel, r); return r;
    }
    case 'drag': { // two nodes, so it cannot ride the single-selector dispatcher
      const tab = await tabFor(step.tab);
      const from = (step.from && step.from.sel) || null, to = (step.to && step.to.sel) || null;
      run(tab, from);
      const res = await send$(tab, { op: 'drag', from: { sel: from }, to: { sel: to } });
      const r = strip(res, 'drag', i);
      for (const k of ['handled', 'from', 'to']) if (res && res[k] !== undefined) r[k] = res[k];
      done(tab, from, r); return r;
    }
    case 'relay': {
      const src = await tabFor(step.from.tab), dst = await tabFor(step.to.tab);
      run(src, step.from.sel); run(dst, step.to.sel);
      const rd = await send$(src, { op: 'readRaw', sel: step.from.sel }, step.from.frameId);
      if (!rd || !rd.ok) { const r = { i, v: 'relay', ok: false, error: (rd && rd.error) || 'read failed' }; done(src, step.from.sel, r); return r; }
      // writing '' over a destination looks like success in a receipt and costs
      // a full re-run to notice, so an empty source is its own failure code
      if (!(rd._v || '').trim()) { const r = { i, v: 'relay', ok: false, error: 'source field empty' }; done(src, step.from.sel, r); return r; }
      const wr = await send$(dst, { op: 'writeRaw', sel: step.to.sel, _v: rd._v }, step.to.frameId);
      const r = strip(wr, 'relay', i);
      done(src, step.from.sel, { ok: true, len: (rd._v || '').length });
      done(dst, step.to.sel, r);
      return r;
    }
    case 'swap': {
      const ta = await tabFor(step.a.tab), tb = await tabFor(step.b.tab);
      run(ta, step.a.sel); run(tb, step.b.sel);
      const ra = await send$(ta, { op: 'readRaw', sel: step.a.sel }, step.a.frameId);
      const rb = await send$(tb, { op: 'readRaw', sel: step.b.sel }, step.b.frameId);
      await send$(ta, { op: 'writeRaw', sel: step.a.sel, _v: rb._v }, step.a.frameId);
      const w2 = await send$(tb, { op: 'writeRaw', sel: step.b.sel, _v: ra._v }, step.b.frameId);
      const r = { i, v: 'swap', ok: !!(ra.ok && rb.ok && w2.ok), len: (w2 && w2.len) || 0 };
      done(ta, step.a.sel, r); done(tb, step.b.sel, r); return r;
    }
    case 'move': {
      const src = await tabFor(step.from.tab), dst = await tabFor(step.to.tab);
      run(src, step.from.sel); run(dst, step.to.sel);
      const rd = await send$(src, { op: 'readRaw', sel: step.from.sel }, step.from.frameId);
      if (!rd || !rd.ok) { const r = { i, v: 'move', ok: false, error: 'read failed' }; done(src, step.from.sel, r); return r; }
      if (!(rd._v || '').trim()) { const r = { i, v: 'move', ok: false, error: 'source field empty' }; done(src, step.from.sel, r); return r; }
      await send$(src, { op: 'clearRaw', sel: step.from.sel }, step.from.frameId);
      const wr = await send$(dst, { op: 'writeRaw', sel: step.to.sel, _v: rd._v }, step.to.frameId);
      const r = strip(wr, 'move', i);
      done(src, step.from.sel, { ok: true, len: (rd._v || '').length });
      done(dst, step.to.sel, r); return r;
    }
    case 'openTab': {
      // A tab created without a windowId goes into Chrome's *current* window,
      // which in a session with more than one window is not necessarily the one
      // this run opened — measured: a job's tab landed in a leftover window
      // from the previous run. `windowId`, or `window:{run}` naming one of our
      // own marked windows, makes the target explicit.
      let wid = step.windowId;
      if (!wid && step.window && step.window.run) {
        const inv = await inventory();
        const ids = inv.runs[step.window.run] || [];
        wid = ids.length ? Math.max.apply(null, ids) : undefined;
        if (!wid) {
          return { i, v: 'openTab', ok: false, code: 'no_window',
            error: 'no window marked run ' + step.window.run };
        }
      }
      const create = { url: step.url, active: dndMode ? false : step.active !== false };
      if (wid) create.windowId = wid;
      const t = await chrome.tabs.create(create);
      if (followTabs && !t.active) await chrome.tabs.update(t.id, { active: true }).catch(() => {});
      const loaded = await waitStatus(t.id, 'complete', step.loadTimeout);
      // grace for SPA hydration after the document itself is done
      await new Promise(x => setTimeout(x, step.settle || 1000));
      const r = { i, v: 'openTab', ok: true, tabId: t.id, windowId: t.windowId, loaded };
      if (dndMode && step.active !== false) r.dndDowngraded = 'active forced off';
      if (loaded !== 'complete' && step.requireLoaded !== false) r.error = 'page did not finish loading (' + loaded + ')';
      if (r.error) r.ok = false;
      return r;
    }
    case 'closeTab': {
      const t = await tabFor(step.tab);
      const siblings = await chrome.tabs.query({ windowId: t.windowId });
      // Chrome closes the WINDOW with its last tab, which kills this worker and
      // the profile process: a cleanup step must never be able to take its own
      // runner down. Land a blank tab first, then remove the target.
      const last = siblings.length <= 1;
      let blank = null;
      if (last && !step.force) {
        // Chrome's own new-tab page, not about:blank: the NTP is addressable by
        // url matcher (chrome://newtab/*), about:blank is not a match pattern at
        // all, so a blank anchor would be unaddressable for the rest of the run
        blank = await chrome.tabs.create({ windowId: t.windowId, url: NTP, active: false });
      }
      await chrome.tabs.remove(t.id);
      return { i, v: 'closeTab', ok: true, tabId: t.id, windowId: t.windowId,
        tabsInWindow: siblings.length, keptBlank: last && !step.force,
        anchorTabId: blank ? blank.id : undefined };
    }
    case 'hub': {
      // Blank anchor tab, opened and closed on purpose. It keeps a window alive
      // so closeTab never hits the last-tab case, and it is the future home of
      // the picker/approval surface — which will have to be an extension page,
      // because content scripts do not run in about:blank.
      const existing = hubTabId == null ? null : await chrome.tabs.get(hubTabId).catch(() => null);
      if (step.open === false) {
        if (!existing) return { i, v: 'hub', ok: true, open: false, note: 'no hub tab' };
        await chrome.tabs.remove(existing.id);
        hubTabId = null;
        return { i, v: 'hub', ok: true, open: false };
      }
      if (existing) return { i, v: 'hub', ok: true, open: true, tabId: existing.id, reused: true };
      const t = await chrome.tabs.create({ url: step.url || NTP, active: step.active === true && !dndMode });
      hubTabId = t.id;
      return { i, v: 'hub', ok: true, open: true, tabId: t.id, windowId: t.windowId,
        dndDowngraded: dndMode && step.active === true ? 'active forced off' : undefined };
    }
    case 'activate': {
      // There is no quiet way to activate: the verb IS the screen takeover, so
      // under DND it is refused rather than quietly turned into a no-op that
      // reports success.
      if (dndMode) {
        return { i, v: 'activate', ok: false, code: 'dnd_refused',
          error: 'activate refused: this command runs with dnd' };
      }
      const t = await tabFor(step.tab); await chrome.tabs.update(t.id, { active: true });
      if (t.windowId != null) await chrome.windows.update(t.windowId, { focused: true });
      // reporting which surface we just took over is what lets an operator notice
      // a stray tab in their own window before it becomes a mystery
      return { i, v: 'activate', ok: true, tabId: t.id, windowId: t.windowId, url: safeUrl(t.url), title: t.title };
    }
    case 'key': {
      const tab = await tabFor(step.tab); run(tab, step.sel);
      const res = await send$(tab, { op: 'key', sel: step.sel, key: step.key, code: step.code });
      const r = strip(res, 'key', i); done(tab, step.sel, r); return r;
    }
    case 'inject': { // add a convenience affordance (button/overlay) into the page. No secret crosses.
      const tab = await tabFor(step.tab); run(tab, step.anchor || step.kind);
      const res = await send$(tab, { op: 'inject', kind: step.kind, id: step.id, html: step.html, text: step.text, anchor: step.anchor, copyFrom: step.copyFrom, css: step.css });
      const r = strip(res, 'inject', i);
      r.anchored = !!(res && res.anchored); // false = fell back to the corner overlay, not attached to the page
      done(tab, step.anchor, r); return r;
    }
    // ── frame inventory ────────────────────────────────────────────
    // The answer to "which frame do I address?". A cross-origin iframe is a
    // separate document with its own frameId; every DOM verb takes that id, so
    // an embedded player, checkout or consent frame is reachable without
    // attaching a debugger to the browser.
    case 'frames': {
      const tab = await tabFor(step.tab);
      if (!chrome.webNavigation?.getAllFrames) {
        return { i, v: 'frames', ok: false, code: 'frames_unavailable', error: 'webNavigation API unavailable' };
      }
      const all = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      return { i, v: 'frames', ok: true, tabId: tab.id, count: all.length,
        frames: all.map(f => ({ frameId: f.frameId, parentFrameId: f.parentFrameId,
          url: safeUrl(f.url), error: f.errorOccurred ? true : undefined })) };
    }

    // ── pixels ─────────────────────────────────────────────────────
    case 'screenshot': {
      const tab = await tabFor(step.tab);
      // captureVisibleTab only sees the ACTIVE tab of a window, so a background
      // target must be raised first. That is a screen takeover: refused under
      // dnd rather than silently performed.
      let raised = false;
      if (!tab.active) {
        if (dndMode) {
          return { i, v: 'screenshot', ok: false, code: 'dnd_refused',
            error: 'screenshot needs the tab visible; refused under dnd' };
        }
        await chrome.tabs.update(tab.id, { active: true });
        raised = true;
      }
      const format = step.format === 'png' ? 'png' : 'jpeg';
      const quality = Math.max(10, Math.min(100, Number(step.quality) || 70));
      const raw = await chrome.tabs.captureVisibleTab(tab.windowId,
        format === 'png' ? { format: 'png' } : { format: 'jpeg', quality });
      // A full-resolution PNG of a busy page is several MB; NATS drops payloads
      // over the broker's max_payload, which would look like a lost reply rather
      // than a large image. Downscale in the worker and answer with a size.
      const dataUrl = await shrinkImage(raw, Number(step.maxWidth) || 1280, format, quality);
      const bytes = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
      if (bytes > MAX_IMAGE_BYTES) {
        return { i, v: 'screenshot', ok: false, code: 'screenshot_too_large', bytes,
          error: 'image exceeds the NATS payload budget; lower maxWidth or quality' };
      }
      return { i, v: 'screenshot', ok: true, tabId: tab.id, windowId: tab.windowId,
        format, bytes, raised: raised || undefined, dataUrl };
    }

    // ── session history ────────────────────────────────────────────
    case 'history': {
      const tab = await tabFor(step.tab);
      const action = step.action || 'back';
      const go = { back: chrome.tabs.goBack, forward: chrome.tabs.goForward, reload: chrome.tabs.reload }[action];
      if (!go) return { i, v: 'history', ok: false, code: 'bad_action', error: 'history action must be back, forward or reload' };
      try { await go(tab.id); }
      catch (e) { return { i, v: 'history', ok: false, code: 'no_history', error: String((e && e.message) || e) }; }
      const loaded = await waitStatus(tab.id, 'complete', step.loadTimeout);
      const r = { i, v: 'history', ok: loaded === 'complete', action, loaded };
      if (!r.ok) r.error = 'page did not finish loading (' + loaded + ')';
      return r;
    }

    // ── cookies (metadata out, never values) ───────────────────────
    case 'cookies': {
      if (!chrome.cookies) return { i, v: 'cookies', ok: false, code: 'cookies_unavailable', error: 'cookies API unavailable' };
      const action = step.action || 'list';
      // An unfiltered getAll() would enumerate every cookie in the browser, so
      // a scope is mandatory: an explicit url/domain, or the addressed tab.
      let url = step.url;
      if (!url && !step.domain) {
        const tab = await tabFor(step.tab);
        url = tab.url;
      }
      if (action === 'list') {
        const q = step.domain ? { domain: step.domain } : { url };
        if (step.name) q.name = step.name;
        const all = await chrome.cookies.getAll(q);
        const limit = Math.min(Math.max(Number(step.limit) || 50, 1), 200);
        return { i, v: 'cookies', ok: true, count: all.length, shown: Math.min(all.length, limit),
          cookies: all.slice(0, limit).map(c => ({ name: c.name, domain: c.domain, path: c.path,
            secure: !!c.secure, httpOnly: !!c.httpOnly, session: !!c.session,
            sameSite: c.sameSite, expires: c.expirationDate || null })) };
      }
      if (!url || !step.name) return { i, v: 'cookies', ok: false, code: 'bad_cookie_target', error: 'cookies set/remove need url and name' };
      if (action === 'remove') {
        const gone = await chrome.cookies.remove({ url, name: step.name });
        return { i, v: 'cookies', ok: !!gone, removed: !!gone, name: step.name };
      }
      if (action === 'set') {
        if (typeof step.value !== 'string') return { i, v: 'cookies', ok: false, code: 'field_empty', error: 'cookies set needs a string value' };
        const c = await chrome.cookies.set({ url, name: step.name, value: step.value,
          path: step.path || '/', secure: step.secure === true, httpOnly: step.httpOnly === true,
          sameSite: step.sameSite || 'lax', ...(Number.isFinite(step.expires) ? { expirationDate: step.expires } : {}) });
        return { i, v: 'cookies', ok: !!c, name: step.name, len: step.value.length };
      }
      return { i, v: 'cookies', ok: false, code: 'bad_action', error: 'cookies action must be list, set or remove' };
    }
    default:
      return { i, v: step.v, ok: false, error: 'unknown verb' };
  }
}

async function execute(cmd) {
  const receipts = [];
  let err = null;
  let errCode = null;
  dndMode = cmd.dnd === true;
  followTabs = cmd.follow === true && !dndMode;
  abortFlag = false;
  runningId = cmd.id;
  try {
    const continueOnError = cmd.onError === 'continue';
    // both cleanup verbs run after a halt: a tab we left open is unaddressable
    // and a WINDOW we left open is on the operator's screen — measured, a run
    // that halted on a failed gate skipped its own `close` and leaked two
    // windows until someone swept them by hand
    const isCleanup = s => s && (s.v === 'closeTab' || s.v === 'close');
    let halted = -1;
    let aborted = false;
    for (let i = 0; i < cmd.steps.length; i++) {
      const s = cmd.steps[i];
      if (!s || !s.v) continue; // documentation-only step ({comment}); no verb, no receipt
      if (abortFlag && halted < 0 && !isCleanup(s)) {
        halted = i; aborted = true;
        err = 'aborted at step ' + i;
        errCode = 'aborted';
      }
      if (halted >= 0 && !isCleanup(s)) {
        receipts.push({ i, v: s.v, ok: false, code: aborted ? 'aborted' : 'skipped',
          error: aborted ? 'stopped by operator' : 'skipped (halted after step ' + halted + ')' });
        continue;
      }
      // A verb that THROWS (an unresolvable tab matcher does) used to escape the
      // loop: no receipt for that step, onError:"continue" bypassed, and every
      // later step — including the cleanup that closes the windows we opened —
      // silently skipped. One bad step is a failed step, not a lost run.
      let r;
      try {
        r = await runStep(s, i, cmd.id);
      } catch (e) {
        const msg = String((e && e.message) || e);
        r = { i, v: s.v, ok: false, error: msg, code: codeFor(msg) };
      }
      if (!r.ok && !r.code) r.code = codeFor(r.error);
      receipts.push(r);
      transport.step?.({ id: cmd.id, inst, i, v: s.v, ok: r.ok, code: r.code, phase: 'step' });
      if (!r.ok && halted < 0 && !isCleanup(s) && !continueOnError) {
        halted = i;
        errCode = r.code;
        err = 'halted at step ' + i + ' (' + r.v + (r.error ? ': ' + r.error : '') + ')';
      }
    }
  } catch (e) {
    err = String(e && e.message || e);
    errCode = codeFor(err);
  }
  runningId = null;
  return { receipts, err, errCode, aborted: abortFlag, inst };
}

export async function initExecutor(adapter) {
  transport = adapter;
  await instReady;
  return inst;
}
export function abortCommand(id) {
  if (runningId && runningId === id) { abortFlag = true; return true; }
  return false;
}
export { execute, sessionInfo, helloSoon };
chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
  if (m?.type === 'sessionInfo' && sender.url?.startsWith(chrome.runtime.getURL(''))) {
    instReady.then(async () => sendResponse(await sessionInfo()));
    return true;
  }
  if (m?.type === 'userInvoke') {
    transport.invoke?.({ id: m.id, inst, tabId: sender.tab?.id });
  }
  if (m?.type === 'launch') helloSoon();
  return false;
});
chrome.tabs.onRemoved.addListener(id => { if (id === hubTabId) hubTabId = null; });
chrome.windows.onCreated.addListener(helloSoon);
chrome.windows.onRemoved.addListener(helloSoon);
