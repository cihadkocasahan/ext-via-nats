# Browser commands

A command is one `id` plus an ordered list of steps. The exact profile `inst` is
chosen by the NATS subject, not by a field in the payload.

```json
{
  "id": "task-unique-001",
  "dnd": true,
  "steps": [
    { "v": "fill", "tab": { "url": "https://example.com/*" }, "sel": "#name", "literal": "Example" },
    { "v": "assert", "tab": { "url": "https://example.com/*" }, "sel": "#name", "eq": "Example" }
  ]
}
```

The answer is `{id, inst, ok, receipts, err, errCode, aborted}` — one receipt per
step. The vocabulary below is generated from `src/verbs.js`, which is also what the
MCP tool `ext_via_nats_verbs` serves, so code and docs cannot drift.

## Targeting

- **Profile**: the subject `extvianats.browser.cmd.<inst>`. An email address is not an `inst`.
- **Tab**: `tab:{tabId:123}` or `tab:{url:"https://example.com/*", title:"…", index:0}`.
  URL matches are glob-style; candidates are ordered newest tab first.
- **Frame**: every DOM step accepts `frameId` (default `0`, the top frame). Use the
  `frames` verb to discover ids, including cross-origin iframes.
- **Selector**: CSS, plus `text=…` visible-text selectors.

## Verbs

### Session — profile, window and tab lifecycle

| `v` | Fields / behaviour |
|---|---|
| `version` | Manifest version, build id, inst, permissions. Proves which code the worker loaded. |
| `whoami` | Profile session: inst, windows, tab count, owned windows, run tags. |
| `openWindow` | `url`, `run`, `state`, `focused`, `width/height/left/top`. Opens a window carrying an ownership marker tab. Under `dnd` it opens minimised. |
| `close` | `run`. Closes only marker-carrying windows; operator windows are reported untouched. |
| `openTab` | `url`, `windowId` or `window:{run}`, `active`, `loadTimeout`, `settle`, `requireLoaded`. Name the window explicitly when several are open. |
| `closeTab` | `tab`, `force`. Leaves an anchor tab when closing the last one, so the runner survives. |
| `navigate` | `tab`, `url`, `loadTimeout`, `settle`, `requireLoaded`. Waits for the navigation to start, then to complete. |
| `history` | `tab`, `action:back\|forward\|reload`, `loadTimeout`. |
| `activate` | `tab`. Raises tab and window. Refused under `dnd` — the verb IS the screen takeover. |
| `hub` | `url`, `active`, `open:false`. Anchor tab that keeps a window alive across `closeTab`. |
| `reload` | Reloads the extension from disk. The connection drops; do not blind-retry. |
| `sleep` | `ms`, capped at 20000. Prefer `waitFor` over a blind sleep. |

### Discover — read page structure, frames, text and pixels

| `v` | Fields / behaviour |
|---|---|
| `query` | `tab`, `sel`, `limit`, `text:true`, `frameId`. Shape of every match: tag, id, class, box, visibility, text length. Field values are withheld unless `text:true`. |
| `frames` | `tab`. Frame inventory with `frameId`/`parentFrameId` and origin+path. |
| `getText` | `tab`, `sel`, `max`, `frameId`. Visible text, truncated to `max`. **Egress: page text.** |
| `getHTML` | `tab`, `sel`, `outer`, `max`, `frameId`. Markup; masked field attributes are redacted. **Egress: page markup.** |
| `screenshot` | `tab`, `format:jpeg\|png`, `quality`, `maxWidth`. Visible tab, downscaled in the worker. Raises a background tab, so refused under `dnd`. **Egress: page pixels.** |

### Interact — pointer, keyboard and form input

| `v` | Fields / behaviour |
|---|---|
| `click` | `tab`, `sel`, `frameId`. Scrolls into view, clicks, reports the node it hit. |
| `dblclick` | `tab`, `sel`, `frameId`. Full mouse sequence ending in dblclick. |
| `rightClick` | `tab`, `sel`, `frameId`. contextmenu sequence for custom menus. |
| `hover` | `tab`, `sel`, `frameId`. mouseover/enter/move without a click. |
| `key` | `tab`, `sel`, `key`, `code`, `frameId`. DOM keyboard events — not a native OS key press. |
| `fill` | `tab`, `sel`, `literal`, `frameId`. Literal text only; sets the native value and fires input/change. Secret refs are refused. |
| `select` | `tab`, `sel`, `value\|label\|index`, `frameId`. Chooses an `<option>`, fires input/change. |
| `scroll` | `tab`, `sel`, `align`, `x`, `y`, `byX`, `byY`, `frameId`. A node into view, or the window by/absolute offset. |
| `mouseDrag` | `tab`, `sel`, `dx`, `dy`, `moves`, `frameId`. Interpolated drag for sliders, canvases, sortable handles. |
| `drag` | `tab`, `from:{sel}`, `to:{sel}`, `frameId`. HTML5 drag-and-drop between two nodes; reports whether a handler took it. |
| `media` | `tab`, `sel`, `action:status\|play\|pause\|mute\|unmute\|volume\|rate\|seek`, `value`, `frameId`. Playback state; `src` is origin+path only. |
| `uploadFile` | `tab`, `sel`, `name`, `mime`, `text\|url\|dataUrl`, `frameId`. Builds the file inside the page and assigns `.files` or synthesises a drop. No local filesystem access. |
| `highlight` | `tab`, `sel`, `color`, `ms`, `frameId`. Temporary outline, for a human watching the run. |

### Verify — gates

| `v` | Fields / behaviour |
|---|---|
| `waitFor` | `tab`, `sel`, `timeout`, `grow`, `quiet`, `frameId`. `grow` waits for MORE matches than now; `quiet` waits for text to stop growing. |
| `assert` | `tab`, `sel`, `has:text\|value`, `eq`, `absent`, `frameId`. Answers `len`, never a field value. |
| `captcha` | `tab`, `wait:true`, `timeout`, `frameId`. Detects a challenge and warns on screen. Never solves it; `wait` blocks for the human. |

### Value — move or wipe without exporting

| `v` | Fields / behaviour |
|---|---|
| `relay` | `from:{tab,sel,frameId}`, `to:{tab,sel,frameId}`. Copies a value browser-side. Receipt carries length only. |
| `move` | Same targets. Relay, then clears the source. |
| `swap` | `a:{tab,sel,frameId}`, `b:{tab,sel,frameId}`. Exchanges two values without either leaving the browser. |
| `clear` | `tab`, `sel`, `frameId`. Wipes a field. |
| `setStore` | `tab`, `sel`, `value`, `remove:true`, `frameId`. Writes/deletes `localStorage:KEY`, `sessionStorage:KEY` or `cookie:NAME`; `*` clears the store. Counts only. |
| `cookies` | `tab\|url\|domain`, `action:list\|set\|remove`, `name`, `value`, `path`, `secure`, `httpOnly`, `sameSite`, `expires`, `limit`. Metadata out, never values. A scope is mandatory. |

### Page — affordances and authorised JavaScript

| `v` | Fields / behaviour |
|---|---|
| `inject` | `tab`, `kind:button\|overlay`, `id`, `text`, `anchor`, `copyFrom`, `css`, `frameId`. Adds an affordance; its click emits an `invoke` event. Not arbitrary JS. |
| `script` | `tab`, `code`, `world:USER_SCRIPT\|MAIN`. One-shot authorised JavaScript (Chrome 135+, user-script permission). Return values never leave the browser. |

## Execution rules

`follow:true` brings each affected tab to the front; it is off by default.
`dnd:true` overrides `follow`, refuses focus-stealing verbs, and opens windows
minimised. Unless `onError:"continue"` is given, the run halts at the first failed
step — but `close` and `closeTab` cleanup steps still run after a halt or abort.
That is not a guarantee the cleanup target belongs to you: pick the right run/tab.

One command at a time per profile. A second command gets `busy`; the same id while
running gets `in_progress`.

`inject` is not `eval`. It builds a button or overlay and sends its click to the
NATS `invoke` subject. Dynamic JavaScript is the separate `script` verb, which uses
`chrome.userScripts.execute` and fails closed when the permission is off. The
service worker never runs remote code through `eval` or `new Function`.

## Example: JavaScript via MCP

```json
{
  "inst": "REAL-PROFILE-UUID",
  "id": "script-001",
  "tab_id": 123,
  "code": "document.querySelector('h1').style.color = 'teal';",
  "world": "USER_SCRIPT"
}
```

This is the `ext_via_nats_script` payload. The result is success and a frame count
only. A page's return value could be a token or a cookie, so it is not exported.

## When the outcome is uncertain

A timeout does not mean the command did not run. Re-request with the **same id and
the same content**: still running returns `in_progress`, finished returns the stored
receipt, and a worker that died mid-run returns `interrupted`. The same id with
different content returns `id_conflict`. Use a new id only after you have evaluated
the previous outcome.

The ledger keeps the last 100 commands. That is a bounded record, not an infinite
exactly-once guarantee. NATS Core provides no offline queue: if the connection
drops, the command is not buffered for later.

## Failure codes

`no_tab_id`, `no_tab`, `no_frame`, `element_not_found`, `bad_matcher`,
`page_not_scriptable`, `assert_failed`, `page_not_loaded`, `unknown_verb`,
`timed_out`, `field_empty`, `no_window`, `dnd_refused`, `captcha_unsolved`,
`screenshot_too_large`, `no_history`, `bad_action`, `bad_cookie_target`,
`cookies_unavailable`, `frames_unavailable`, `user_scripts_unavailable`,
`invalid_script`, `script_error`, `secret_ref_unsupported`, `bad_store_sel`,
`store_key_absent`, `cookie_absent`, `aborted`, `skipped`, `busy`, `in_progress`,
`id_conflict`, `interrupted`, `invalid_command`, `execution_error`, `failed`.
