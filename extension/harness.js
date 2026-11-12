// harness.js — renders the state of the session this marker tab belongs to, and
// records what launched the profile when it was the relay that did.
//
// Rendering is not load-bearing for control: `close` reads ownership from this
// tab's URL in the service worker, not from what the page shows. The page exists
// so a human looking at the tab can tell which run claimed it — and, on a
// launch, so the PROFILE keeps a durable answer to "who started me, when, for
// what": the operator may close this tab, the worker may be frozen, the browser
// may restart, and the record is still there.
const set = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value == null || value === '' ? '—' : String(value);
};

const q = new URLSearchParams(location.search);
const run = q.get('run') || 'unmarked';
set('run', run);

// Launch provenance. relayd opens THIS page as the profile's startup tab with
// `at` (launch time), `task`, `purpose` and `label` in the query; nothing else
// ever builds such a URL, so an `at` here is the marker that the relay — not the
// operator — started this profile. Persist it like arInst, then nudge the
// worker so relayd learns it now rather than at the next window event.
const at = q.get('at');
if (at) {
  const rec = {
    run,
    at: Number(at) || null,
    via: q.get('via') || 'launch',
    task: q.get('task') || null,
    purpose: q.get('purpose') || null,
    label: q.get('label') || null,
    profileId: q.get('profileId') || null,
    recordedAt: Math.floor(Date.now() / 1000),
  };
  try {
    chrome.storage.local.set({ arLaunch: rec }, () => {
      try { chrome.runtime.sendMessage({ type: 'launch' }); } catch (e) {}
    });
  } catch (e) {}
}

// Read the record back from storage rather than from a query string or a reply:
// one source of truth, and it is the same one relayd sees via sessionInfo.
chrome.storage.local.get('arLaunch', (got) => {
  const launch = (got && got.arLaunch) || null;
  if (launch && launch.at) {
    set('launched', 'relay @ ' + new Date(launch.at * 1000).toLocaleString());
    set('task', launch.task);
    set('purpose', launch.purpose);
  } else {
    set('launched', 'kayit yok (relay ile baslatilmadi)');
  }
});

chrome.runtime.sendMessage({ type: 'sessionInfo' }, (info) => {
  if (chrome.runtime.lastError || !info) {
    set('note', 'relay worker yanit vermedi — oturum kaydi tutulmuyor');
    return;
  }
  set('inst', info.inst);
  set('ver', info.ver);
  set('build', info.build);
  set('acct', info.acct);
  set('wins', (info.windows || []).map(w => w.id + (info.ours.includes(w.id) ? '*' : '')).join(' ') || 'yok');
  const owned = (info.ours || []).length;
  set('note', owned
    ? `bizim acilar: ${owned} pencere (yildizli) / toplam ${(info.windows || []).length}`
    : 'bu profilde acik pencere bizden degil');
});
