// harness.js — renders the session this marker tab belongs to.
//
// Rendering is not load-bearing for control: `close` reads ownership from this
// tab's URL in the service worker, not from what the page shows. The page exists
// so a human looking at the tab can tell which run claimed it.
const set = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value == null || value === '' ? '—' : String(value);
};

set('run', new URLSearchParams(location.search).get('run') || 'unmarked');

chrome.runtime.sendMessage({ type: 'sessionInfo' }, (info) => {
  if (chrome.runtime.lastError || !info) {
    set('note', 'service worker did not answer — session state unavailable');
    return;
  }
  set('inst', info.inst);
  set('ver', info.ver);
  set('build', info.build);
  set('wins', (info.windows || []).map(w => w.id + (info.ours.includes(w.id) ? '*' : '')).join(' ') || 'none');
  const owned = (info.ours || []).length;
  set('note', owned
    ? `owned windows: ${owned} (starred) / ${(info.windows || []).length} total`
    : 'no window in this profile was opened by us');
});