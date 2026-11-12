// content.js — isolated-world verb executor for Agent Relay.
// Receives ops from background.js via chrome.runtime/tabs messaging.
// Never exposes raw secret values: readRaw is used only by the SW to move
// values tab-to-tab; every reply that leaves the browser is stripped to
// {ok, len, tail4}.

// executeScript re-runs THIS file into an isolated world that may already hold
// an older copy (tabs that survived an extension reload). Unwrapped, the re-run
// dies on "Identifier 'hudEl' has already been declared" and the whole tab
// stops answering. The IIFE keeps each copy's bindings private; the generation
// counter makes only the newest copy respond.
(() => {
'use strict';
const GEN = globalThis.__arGen = (globalThis.__arGen || 0) + 1;

// A profile that no one has activated in this browser run keeps its service
// worker frozen, and an agent cannot click reload in another profile's
// chrome://extensions. Content scripts, though, are injected by the browser
// itself — so opening our own relayd page in that profile is enough to wake the
// worker. Nothing on any third-party page sends this.
if (/^http:\/\/127\.0\.0\.1:8712\/wake$/.test(location.href)) {
  try { chrome.runtime.sendMessage({ type: 'wake' }); } catch (e) {}
}

function setNativeValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : (el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLElement.prototype);
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// Hide the text we just wrote from the screen — for a recording, a share, or a
// shoulder. It is NOT protection against the page's own scripts or devtools:
// `el.value` still holds the real value, and pretending otherwise would be a
// worse bug than the one it fixes. Applied as an attribute plus inline
// text-security, so a playbook can gate on [data-ar-mask] the way it gates on
// any affordance we add.
function applyMask(el) {
  try {
    el.setAttribute('data-ar-mask', '1');
    el.style.setProperty('-webkit-text-security', 'disc', 'important');
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('spellcheck', 'false');
    return true;
  } catch (_) { return false; }
}

// Visible-text lookup. Many admin UIs hand out only generated ids
// (base-ui-_r_1f_), so text is the stable handle. Both forms below resolve to
// this: "text=foo" and '[textContent="foo"]'.
// Our own injected affordances (data-ar-node) are skipped: their labels echo
// page text, and a gate that matched one would pass without the real element
// being there. Assert on those nodes by CSS id when you mean them.
// A page can render the same label twice and put the invisible one FIRST.
// Measured on DeepSeek's sign-in form: two spans reading "Google ile Giriş Yap",
// a visibility:hidden measuring copy at 297,594 and the real button content at
// 350,603. Matching the copy made `assert text=Google` pass and `click` fire on
// a node with no listeners — ok:true, page unmoved. Same fail-open family as the
// HUD echo: a gate must never pass on something the user cannot see.
function isVisible(el) {
  if (!el || !el.isConnected) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
}

// An inert click used to answer ok:true and nothing else, so "did it hit the
// node I meant?" could only be answered from devtools. Identity, not content:
// a label can carry a value, so no text leaves here.
function describe(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const d = { tag: el.tagName.toLowerCase(), vis: isVisible(el),
    box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
  if (el.id) d.id = el.id;
  const cls = el.getAttribute && el.getAttribute('class');
  if (cls) d.cls = String(cls).slice(0, 90);
  // text= lands on the label span, but the handler lives on the button above
  // it. Naming that ancestor is what makes a language-independent selector
  // measurable instead of guessed.
  const up = el.closest('button,[role="button"],a,input[type="submit"]');
  if (up && up !== el) {
    d.btn = { tag: up.tagName.toLowerCase() };
    if (up.id) d.btn.id = up.id;
    const bc = up.getAttribute('class');
    if (bc) d.btn.cls = String(bc).slice(0, 90);
    for (const a of ['jsname', 'data-testid', 'name', 'type']) {
      const v = up.getAttribute(a);
      if (v) d.btn[a] = v;
    }
  }
  return d;
}

function byTextAll(needle) {
  const out = [];
  if (!needle) return out;
  const root = document.body || document.documentElement;
  if (!root) return out;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n, scanned = 0;
  while ((n = walker.nextNode()) && scanned++ < 20000) {
    if (!(n.nodeValue && n.nodeValue.indexOf(needle) !== -1)) continue;
    const p = n.parentElement;
    if (!p || p.closest('[data-ar-node]') || !isVisible(p)) continue;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

function byText(needle) {
  return byTextAll(needle)[0] || null;
}

// CAPTCHA is the one gate we never solve. Detection is a set of signals rather
// than one vendor: measured on Google's OAuth step, the challenge was a drag
// puzzle with NO recaptcha iframe, so an iframe-only probe answered "no
// captcha" while a human was being asked to slide something.
// Our own warning banner carries data-ar-node and is excluded, or the gate
// would detect itself and never clear — the same fail-open family as the HUD.
// isVisible() answers "is it rendered", not "can a person see it here". The
// DeepSeek sign-in page PRELOADS a captcha iframe off-screen at y=-9999 that is
// still 320x400 and passes isVisible — matching it would gate every run on a
// challenge nobody was shown. So anything generic must clear the viewport too.
function onScreen(el) {
  const r = el.getBoundingClientRect();
  const vh = innerHeight || document.documentElement.clientHeight || 0;
  const vw = innerWidth || document.documentElement.clientWidth || 0;
  return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
}

function captchaKind() {
  // Scan EVERY candidate frame, not just the first match in document order.
  // `first()` prefers the first VISIBLE match; document.querySelector does not,
  // and the DeepSeek sign-in page keeps a hidden preload of the same hCaptcha
  // frame EARLIER in the DOM. Measured: with the challenge live and on screen
  // (a click on this very selector reported vis:true at [162,270,320,400]),
  // `captcha` still answered present:false — the probe examined the hidden
  // preload and stopped. Answering "no challenge" while a human is looking at
  // one is the fail-open family this file keeps paying for.
  const frames = document.querySelectorAll(
    'iframe[src*="recaptcha" i],iframe[src*="hcaptcha" i],iframe[src*="geetest" i],' +
    'iframe[src*="arkose" i],iframe[src*="turnstile" i],iframe[src*="captcha" i],' +
    'iframe[title*="recaptcha" i],iframe[title*="challenge" i]');
  // Rendered AND on screen. The preload above sits at y=-9999 yet still measures
  // 320x400, so it can pass isVisible; gating every run on a challenge nobody
  // was shown is the mirror-image mistake of missing a live one.
  for (const f of frames) if (isVisible(f) && onScreen(f)) return 'iframe';
  const els = document.querySelectorAll('[id*="captcha" i],[class*="captcha" i],[data-testid*="captcha" i]');
  for (const el of els) {
    if (el.closest('[data-ar-node]')) continue;
    if (isVisible(el)) return 'dom';
  }
  return null;
}

// The human gate banner. It is not only a notice: while a `captcha … wait` step
// is blocked, the button is the operator's explicit "continue" — for when the
// challenge is cleared but detection has not caught up, or the operator judges
// it handled. Auto-resume (the challenge going away) still works on its own; the
// two exits are independent, so the human never has to wait out the timer.
function captchaWarn(on, onApprove) {
  const id = 'ar-captcha-warn';
  const old = document.getElementById(id);
  if (old) old.remove();
  if (!on) return;
  const n = document.createElement('div');
  n.id = id;
  n.setAttribute('data-ar-node', '1');
  n.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#b62324;color:#fff;' +
    'font:600 14px/1.4 system-ui,sans-serif;padding:10px 16px;display:flex;gap:12px;align-items:center;' +
    'justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,.4)';
  const msg = document.createElement('span');
  msg.textContent = onApprove
    ? 'CAPTCHA algılandı — çözünce otomatik devam eder, ya da:'
    : 'CAPTCHA algılandı — insan adımı.';
  n.appendChild(msg);
  if (onApprove) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'ar-captcha-ok';
    btn.textContent = 'Çözdüm, devam et';
    btn.style.cssText = 'cursor:pointer;border:0;border-radius:4px;padding:6px 14px;' +
      'font:600 14px system-ui,sans-serif;background:#fff;color:#b62324';
    btn.addEventListener('click', () => { captchaWarn(false); onApprove(); });
    n.appendChild(btn);
  }
  (document.body || document.documentElement).appendChild(n);
}

// Clipboard write from the isolated world. navigator.clipboard needs both the
// clipboardWrite permission and document focus, which a relay-driven synthetic
// click can lack, so keep the legacy command as the fallback.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    (document.body || document.documentElement).appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) { return false; }
}

// XPath. DevTools' "Copy full XPath" hands back /html/body/div[1]/div[3]…, and
// querySelector does not merely miss it — it THROWS, so a pasted path used to
// come back as "no element" with nothing pointing at the syntax. Both copy
// modes are accepted: `//x` (anywhere) and `/html/…` (absolute). A `|` union is
// not supported, because `|` already means "try the next selector" here.
function isXPath(q) {
  return q.slice(0, 2) === '//' || q[0] === '/' || q[0] === '(';
}

function xpathAll(q) {
  const out = [];
  try {
    const res = document.evaluate(q, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let k = 0; k < res.snapshotLength; k++) {
      const n = res.snapshotItem(k);
      if (n && n.nodeType === 1) out.push(n);
    }
  } catch (_) { /* malformed path: an empty match, like a broken CSS selector */ }
  return out;
}

// Every node a selector matches, in the same order of preference the verbs use:
// the first candidate of the chain that matches anything at all. `first` and
// `query` split here on purpose — `first` prefers what is visible, `query`
// reports everything, because "which of these is the operator looking at" is
// exactly the question a discovery step is asked.
function allMatches(sel) {
  if (!sel) return [];
  for (const s of String(sel).split('|')) {
    let q = s.trim();
    if (!q) continue;
    if (q.slice(0, 5).toLowerCase() === 'last=') q = q.slice(5).trim();
    const named = /^\[textContent\s*=\s*["'](.+)["']\]$/.exec(q);
    if (named) q = 'text=' + named[1];
    if (q.slice(0, 5).toLowerCase() === 'text=') {
      const all = byTextAll(q.slice(5).trim());
      if (all.length) return all;
      continue;
    }
    if (isXPath(q)) {
      const all = xpathAll(q);
      if (all.length) return all;
      continue;
    }
    for (const cand of [q, '[name="' + q + '"]', '[data-testid="' + q + '"]']) {
      try { const all = Array.from(document.querySelectorAll(cand)); if (all.length) return all; } catch (_) {}
    }
  }
  return [];
}

function first(sel) {
  if (!sel) return null;
  // allow a small selector fallback chain "css|css"
  for (const s of String(sel).split('|')) {
    let q = s.trim();
    if (!q) continue;
    // `last=` picks the LAST match instead of the first. A chat transcript
    // renders one .ds-markdown per answer, so a first-match gate reads the
    // OLDEST one: measured, a completion gate reported len:140 twice while the
    // new answer was still streaming — it was measuring the previous answer.
    // Same fail-open family as the invisible duplicate: a gate has to measure
    // the thing this run just produced.
    let wantLast = false;
    if (q.slice(0, 5).toLowerCase() === 'last=') { wantLast = true; q = q.slice(5).trim(); }
    const named = /^\[textContent\s*=\s*["'](.+)["']\]$/.exec(q);
    if (named) q = 'text=' + named[1];
    if (q.slice(0, 5).toLowerCase() === 'text=') {
      const all = byTextAll(q.slice(5).trim());
      const el = wantLast ? all[all.length - 1] : all[0];
      if (el) return el;
      continue;
    }
    if (isXPath(q)) {
      const all = xpathAll(q);
      const vis = all.filter(isVisible);
      const pool = vis.length ? vis : all;
      const el = wantLast ? pool[pool.length - 1] : pool[0];
      if (el) return el;
      continue;
    }
    let all = [];
    try { all = Array.from(document.querySelectorAll(q)); } catch (_) { all = []; }
    if (!all.length) {
      try { all = Array.from(document.querySelectorAll('[name="' + q + '"]')); } catch (_) {}
    }
    if (!all.length) {
      try { all = Array.from(document.querySelectorAll('[data-testid="' + q + '"]')); } catch (_) {}
    }
    // Prefer what the operator can see. Measured: `[id*=add]` on the Agent2API
    // panel resolved to button#rail-add-custom with vis:false and a 0x0 box, so
    // `click` fired on a hidden button and reported ok:true. The unfiltered
    // first match stays as a fallback, because `assert` on a hidden element and
    // `fill` on a hidden input are both legitimate.
    const vis = all.filter(isVisible);
    const pool = vis.length ? vis : all;
    const el = wantLast ? pool[pool.length - 1] : pool[0];
    if (el) return el;
  }
  return null;
}

// How many nodes a selector matches. `waitFor grow:true` needs this: a chat
// transcript already holds every previous answer, so "does .ds-markdown exist"
// is true before the new answer arrives and the gate passes on the old one.
function countMatches(sel) {
  // one implementation, so `waitFor grow:true` and `query` can never disagree
  // about what a selector matches or about XPath support
  return allMatches(sel).length;
}

function readValue(el) {
  if (!el) return '';
  if ('value' in el) return String(el.value || '');
  return String(el.textContent || '').trim();
}

function tail4(v) { return v.length >= 4 ? v.slice(-4) : ''; }

// ---- HUD: live, NON-SECRET step feed (top-center banner) ----
// The HUD renders into a shadow root on purpose. Its lines repeat the selector
// of the step being run, so a HUD living in the light DOM makes `text=foo`
// assertions and waits match their OWN status line and pass on a page where the
// element was never added. TreeWalker and querySelector do not cross a shadow
// boundary, which keeps our feed out of what we are verifying.
let hudEl, hudLog, hudHide;
function ensureHud() {
  // reuse an existing shell so multiple content-script instances (manifest +
  // on-demand executeScript) share ONE visible HUD instead of stacking.
  const existing = document.getElementById('__agentRelayHud');
  if (existing && !existing.shadowRoot) existing.remove(); // pre-shadow shell from an older copy
  if (existing && existing.shadowRoot) {
    hudEl = existing;
    hudLog = existing.shadowRoot.querySelector('#__arhLog');
    if (hudLog) return;
  }
  hudEl = document.createElement('div');
  hudEl.id = '__agentRelayHud';
  hudEl.setAttribute('data-ar-node', '1');
  hudEl.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
    'opacity:0;transition:opacity .25s;pointer-events:auto;cursor:pointer';
  const root = hudEl.attachShadow({ mode: 'open' });
  (document.body || document.documentElement).appendChild(hudEl);
  const box = document.createElement('div');
  box.style.cssText = 'font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;background:rgba(15,17,21,.92);' +
    'color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:6px 10px;max-width:92vw;' +
    'box-shadow:0 4px 18px rgba(0,0,0,.4)';
  box.innerHTML = '<div id="__arhHead" style="color:#8b949e;margin-bottom:2px">Agent Relay</div><div id="__arhLog"></div>';
  root.appendChild(box);
  hudLog = root.querySelector('#__arhLog');
  hudLog.style.maxHeight = '68px'; hudLog.style.overflow = 'auto';
  hudEl.addEventListener('click', () => {
    const open = hudEl.dataset.expanded === '1';
    hudEl.dataset.expanded = open ? '0' : '1';
    hudLog.style.maxHeight = open ? '68px' : '60vh';
  });
}
function showHud() {
  ensureHud(); hudEl.style.opacity = '1';
  clearTimeout(hudHide); hudHide = setTimeout(() => { if (hudEl) hudEl.style.opacity = '0.18'; }, 15000);
}
function hudLine(l) {
  if (!l || !l.v) return;
  ensureHud();
  const c = l.phase === 'run' ? '#d29922' : (l.ok ? '#3fb950' : '#f85149');
  const sel = l.sel ? String(l.sel).slice(0, 26) : '';
  let extra = '';
  if (typeof l.len === 'number') extra = ' · len=' + l.len + (l.tail4 ? (' …' + l.tail4) : '');
  const row = document.createElement('div');
  row.style.color = c;
  row.textContent = (l.phase === 'run' ? '▶ ' : (l.ok ? '✓ ' : '✗ ')) + '#' + l.i + ' ' + l.v + ' ' + sel + extra + (l.error ? (' — ' + l.error) : '');
  hudLog.appendChild(row);
  while (hudLog.children.length > 5) hudLog.removeChild(hudLog.firstChild);
  if (l.id) hudEl.shadowRoot.querySelector('#__arhHead').textContent = 'Agent Relay · ' + l.id;
  hudLog.scrollTop = hudLog.scrollHeight;
  showHud();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (globalThis.__arGen !== GEN) return; // a newer copy owns this page
  (async () => {
    try {
      switch (msg.op) {
        case 'ping':
          return sendResponse({ ok: true, href: location.href });

        case 'waitFor': {
          const t = msg.timeout || 8000;
          // grow: wait for MORE matches than exist right now, i.e. for a node
          // this run caused. Presence alone is already true on a transcript.
          const base = msg.grow ? countMatches(msg.sel) : 0;
          const textLen = () => {
            const el = first(msg.sel);
            return el ? String(el.textContent || '').length : -1;
          };
          // quiet: wait until the matched text stops growing for N ms. A
          // streaming answer has no DOM marker (measured: [class*=stop],
          // [class*=loading], [class*=generat] all absent mid-stream), so
          // "finished" can only be expressed as stability. Two len reads in a
          // playbook cannot express it — they are two receipts, not a gate.
          let lastLen = -1, lastChange = Date.now();
          const hit = () => {
            if (msg.quiet) {
              const n = textLen();
              if (n !== lastLen) { lastLen = n; lastChange = Date.now(); }
              return n > 0 && Date.now() - lastChange >= msg.quiet;
            }
            return msg.grow ? countMatches(msg.sel) > base : !!first(msg.sel);
          };
          const count = () => msg.quiet ? textLen() : countMatches(msg.sel);
          if (hit()) return sendResponse({ ok: true, count: count() });
          // event-driven so background-tab timer throttling can't stall it
          await new Promise(resolve => {
            const t0 = Date.now();
            let done = false;
            const finish = () => { if (done) return; done = true; mo.disconnect(); clearInterval(iv); resolve(); };
            const mo = new MutationObserver(() => { if (hit()) finish(); });
            mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
            // quiet needs a clock even when the DOM stops mutating: the last
            // mutation is what STARTS the silence window.
            const iv = setInterval(() => { if (hit() || Date.now() - t0 > t) finish(); }, 200);
            setTimeout(finish, t);
          });
          const ok = hit();
          return sendResponse({ ok, count: count(), error: ok ? undefined : 'waitFor timeout' });
        }

        case 'captcha': {
          let kind = captchaKind();
          let approved = false;
          if (!msg.wait || !kind) {
            if (kind) captchaWarn(true);
            return sendResponse({ ok: true, present: !!kind, kind: kind || undefined });
          }
          // A live challenge: announce it, then block. There are TWO exits —
          //   * the operator solves it, so captchaKind() goes null (auto-resume), or
          //   * the operator clicks the banner's button (explicit approval).
          // MutationObserver as well as a timer, because a backgrounded tab
          // throttles setInterval and the human may solve it while this tab is
          // not the active one.
          captchaWarn(true, () => { approved = true; });
          const t0 = Date.now();
          const budget = Math.min(msg.timeout || 50000, 55000);
          await new Promise(resolve => {
            let settled = false;
            const finish = () => { if (settled) return; settled = true; mo.disconnect(); clearInterval(iv); resolve(); };
            const mo = new MutationObserver(() => { if (approved || !captchaKind()) finish(); });
            mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
            const iv = setInterval(() => { if (approved || !captchaKind() || Date.now() - t0 > budget) finish(); }, 500);
          });
          kind = captchaKind();
          const go = !kind || approved;
          if (go) captchaWarn(false);
          return sendResponse({ ok: go, present: !!kind, kind: kind || undefined,
            approved: approved || undefined,
            waitedMs: Date.now() - t0,
            error: go ? undefined : 'captcha still present after ' + (Date.now() - t0) + 'ms' });
        }

        case 'click': {
          const el = first(msg.sel);
          if (!el) return sendResponse({ ok: false, error: 'click: no element' });
          el.scrollIntoView({ block: 'center' });
          const hit = describe(el);
          el.click();
          return sendResponse({ ok: true, hit });
        }

        case 'fill': { // literal, non-secret text only (labels/usernames)
          const el = first(msg.sel);
          if (!el) return sendResponse({ ok: false, error: 'fill: no element' });
          setNativeValue(el, String(msg.literal ?? ''));
          return sendResponse({ ok: true, len: String(msg.literal ?? '').length });
        }

        case 'assert': {
          const el = first(msg.sel);
          if (msg.absent) return sendResponse({ ok: !el, error: el ? 'element present' : undefined });
          if (!el) return sendResponse({ ok: false, error: 'assert: no element' });
          let got;
          let secretish = false;
          if (msg.has === 'text') {
            // textContent, not readValue: <button> and <option> own a `value`
            // property, so asserting a label through readValue reads '' and the
            // step fails on an element that is plainly on the page
            got = String(el.textContent || '').trim();
          } else if (msg.has === 'value') {
            got = readValue(el);
            // a password field, or one we masked ourselves, is a secret by
            // definition — the playbook may ask for the value, it does not get
            // to pull part of it out through an assertion
            secretish = el.type === 'password' || !!el.getAttribute('data-ar-mask');
          } else {
            return sendResponse({ ok: true }); // existence only; never echo a field value
          }
          const pass = msg.eq == null ? got.length > 0 : got === msg.eq;
          // len/tail4 makes a failed text assertion self-diagnosing without
          // shipping page text out of the browser
          return sendResponse({ ok: pass, match: pass, len: got.length,
            tail4: secretish ? undefined : tail4(got) });
        }

        case 'query': {
          // Discovery. Until now the only read-back a step had was `assert`'s
          // len/tail4, so choosing a selector was guesswork paid for in
          // round-trips (measured: four dead probes in a row on a React panel
          // whose ids carry a per-render prefix). This returns the SHAPE of
          // every match — tag, id, class, box, visibility, text length — so the
          // next step can be aimed instead of guessed. Text itself stays in the
          // page unless `text:true`, and NEVER for a field or a masked node:
          // "read the page" must not become a way to read a value out of it.
          const all = allMatches(msg.sel);
          const limit = Math.min(Math.max(Number(msg.limit) || 25, 1), 100);
          const items = all.slice(0, limit).map((el, k) => {
            const r = el.getBoundingClientRect();
            const field = /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.getAttribute('data-ar-mask');
            const text = String(el.textContent || '').trim();
            const it = {
              i: k,
              tag: el.tagName.toLowerCase(),
              id: el.id || undefined,
              cls: (el.getAttribute('class') || '').slice(0, 120) || undefined,
              box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
              vis: isVisible(el),
              len: text.length,
            };
            if (field) it.field = true;
            if (msg.text === true) it.text = field ? '(field value withheld)' : text.slice(0, 80);
            return it;
          });
          return sendResponse({ ok: true, count: all.length, shown: items.length, items });
        }

        // internal: raw value for cross-tab move; only answered to our SW, stripped in receipts
        case 'readRaw': {
          // A browser-side source. `sel` may name a store instead of an element:
          //   localStorage:KEY[#dotted.path]  sessionStorage:KEY[#…]  cookie:NAME
          // The value is read inside the tab and handed to the SW, which writes
          // it into the destination tab. It never reaches relayd or the agent —
          // same channel as a field-to-field relay, different source.
          // DeepSeek keeps its token as JSON in localStorage.userToken with the
          // token in .value, which is why a path is supported.
          const store = /^(localStorage|sessionStorage|cookie):([^#]+)(?:#(.+))?$/.exec(String(msg.sel || ''));
          if (store) {
            const kind = store[1], key = store[2].trim(), path = store[3];
            let raw = null;
            if (kind === 'cookie') {
              const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + esc + '=([^;]*)'));
              raw = m ? decodeURIComponent(m[1]) : null;
              // HttpOnly is a real limit, not a bug: say so instead of answering
              // "empty" and letting the caller think the session is logged out.
              if (raw == null) return sendResponse({ ok: false, error: 'cookie absent or HttpOnly (invisible to JS): ' + key });
            } else {
              raw = (kind === 'localStorage' ? localStorage : sessionStorage).getItem(key);
              if (raw == null) return sendResponse({ ok: false, error: kind + ' key absent: ' + key });
            }
            let v = raw;
            if (path) {
              let p;
              try { p = JSON.parse(raw); } catch (_) {
                return sendResponse({ ok: false, error: 'store value is not JSON, cannot follow path: ' + path });
              }
              for (const part of path.split('.')) p = (p == null) ? undefined : p[part];
              if (typeof p !== 'string' || !p) return sendResponse({ ok: false, error: 'path did not resolve to a non-empty string: ' + path });
              v = p;
            }
            return sendResponse({ ok: true, _v: v });
          }
          // a missing element and a blank one are different failures: the first
          // means the page is not the page we think it is, the second means it
          // is the right page with nothing on it yet
          const el = first(msg.sel);
          if (!el) return sendResponse({ ok: false, error: 'no element' });
          return sendResponse({ ok: true, _v: readValue(el) });
        }

        // internal: write a value carried by the SW. No tail4: this op only ever
        // carries a secret (relay / move / swap / put), and the last four
        // characters of a token are real entropy once they reach a receipt —
        // measured: a `move` receipt handed back "cdef" of a live-looking token.
        // Verification for these verbs is `len` plus a page-side gate.
        case 'writeRaw': {
          const el = first(msg.sel);
          if (!el) return sendResponse({ ok: false, error: 'writeRaw: no element' });
          setNativeValue(el, String(msg._v ?? ''));
          const masked = msg.mask ? applyMask(el) : false;
          return sendResponse({ ok: true, len: String(msg._v ?? '').length, masked });
        }

        case 'clearRaw': {
          const el = first(msg.sel);
          if (!el) return sendResponse({ ok: false, error: 'clearRaw: no element' });
          setNativeValue(el, '');
          return sendResponse({ ok: true });
        }

        // The mirror of readRaw: nothing could WRITE a browser-side store, so
        // ending a session meant walking the site's own menus — and on
        // chat.deepseek.com that menu is not reachable from here at all.
        // `remove:true` deletes, `*` clears the whole store (or every
        // JS-visible cookie). Receipt carries counts, never a value.
        // HttpOnly cookies are outside a page's reach; that is a limit, so the
        // receipt reports what is LEFT instead of claiming a clean slate.
        case 'setStore': {
          const m = /^(localStorage|sessionStorage|cookie):(.+)$/.exec(String(msg.sel || ''));
          if (!m) return sendResponse({ ok: false, code: 'bad_store_sel',
            error: 'setStore sel must be localStorage:KEY | sessionStorage:KEY | cookie:NAME (use * for all)' });
          const kind = m[1], key = m[2].trim(), remove = msg.remove === true;
          if (kind === 'cookie') {
            const names = key === '*'
              ? document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(Boolean)
              : [key];
            if (!names.length) return sendResponse({ ok: false, code: 'cookie_absent',
              error: 'no JS-visible cookie to remove (HttpOnly cookies are invisible to the page)' });
            // a cookie dies by being expired at the path it was set on; root
            // plus the current directory covers what a page sets for itself
            const dir = location.pathname.replace(/[^/]*$/, '');
            const paths = dir && dir !== '/' ? ['/', dir] : ['/'];
            for (const n of names) {
              for (const p of paths) {
                document.cookie = n + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=' + p;
              }
            }
            const left = document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(Boolean);
            return sendResponse({ ok: true, cleared: names.length, left: left.length });
          }
          const st = kind === 'localStorage' ? localStorage : sessionStorage;
          if (key === '*') { const n = st.length; st.clear(); return sendResponse({ ok: true, cleared: n }); }
          if (remove) {
            if (st.getItem(key) == null) return sendResponse({ ok: false, code: 'store_key_absent',
              error: kind + ' key absent: ' + key });
            st.removeItem(key);
            return sendResponse({ ok: true, cleared: 1 });
          }
          if (msg.value === undefined) return sendResponse({ ok: false, code: 'bad_store_sel',
            error: 'setStore needs value:"<literal>" or remove:true' });
          st.setItem(key, String(msg.value));
          return sendResponse({ ok: true, len: String(msg.value).length });
        }

        case 'hud':
          hudLine(msg.line || {});
          return sendResponse({ ok: true });

        case 'key': {
          const el = first(msg.sel);
          if (el) el.focus();
          const target = el || document.activeElement || document.body;
          const opts = { key: msg.key, code: msg.code || msg.key, bubbles: true, cancelable: true };
          target.dispatchEvent(new KeyboardEvent('keydown', opts));
          target.dispatchEvent(new KeyboardEvent('keypress', opts));
          target.dispatchEvent(new KeyboardEvent('keyup', opts));
          return sendResponse({ ok: true });
        }

        // inject a convenience affordance into the page.
        // With `anchor` it becomes a real sibling of a page element (inserted
        // before it, so it sits to the left of the text in a header row); the
        // fixed overlay position is only the fallback when there is nothing to
        // attach to. `copyFrom` (defaults to the anchor) makes the click copy
        // that element's own text — page text, never a field value.
        case 'inject': {
          const id = msg.id || ('ar-' + (msg.kind || 'btn'));
          const old = document.getElementById(id);
          if (old) old.remove();
          const src = first(msg.copyFrom || msg.anchor);
          const node = document.createElement(msg.kind === 'overlay' ? 'div' : 'button');
          node.id = id;
          node.setAttribute('data-ar-node', '1');
          node.style.cssText = (src ? 'margin:0 6px;vertical-align:middle;' : 'position:fixed;top:44px;right:16px;') +
            'z-index:2147483646;' + (msg.css || 'font:13px system-ui;padding:8px 12px;border-radius:8px;border:1px solid #30363d;background:#238636;color:#fff;cursor:pointer');
          node.textContent = msg.text || msg.html || '⚡ Relay';
          if (src && src.parentElement) src.parentElement.insertBefore(node, src);
          else (document.body || document.documentElement).appendChild(node);
          node.addEventListener('click', async () => {
            if (!msg.copyFrom && !msg.anchor) {
              try { chrome.runtime.sendMessage({ type: 'userInvoke', id }); } catch (e) {}
              return;
            }
            const text = String((first(msg.copyFrom || msg.anchor) || {}).textContent || '').trim();
            const ok = await copyText(text);
            node.dataset.arCopied = ok ? '1' : '0';
            node.textContent = ok ? '✓ ' + (text || '(boş)') : '✗ kopyalanamadı';
            setTimeout(() => { node.textContent = msg.text || msg.html || '⚡ Relay'; }, 2000);
          });
          return sendResponse({ ok: true, anchored: !!(src && src.parentElement) });
        }

        default:
          return sendResponse({ ok: false, error: 'unknown op ' + msg.op });
      }
    } catch (e) {
      return sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();
  return true; // async
});

// version probe + always-ready HUD: create the (hidden) shell on load so its
// presence confirms the current content.js is running. Stays invisible until a
// hud line arrives (showHud raises opacity).
try { if (document.body) ensureHud(); } catch (e) {}
})();
