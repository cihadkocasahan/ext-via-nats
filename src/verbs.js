// verbs.js — the wire vocabulary, in one place.
// The MCP server exposes this catalog to agents, and the command reference is
// written from it, so a verb cannot exist in code but be undocumented (or the
// reverse). `egress` marks the verbs that deliberately return page data.
export const GROUPS = {
  session: 'Profile, window and tab lifecycle',
  discover: 'Read page structure, frames, text and pixels',
  interact: 'Pointer, keyboard and form input',
  verify: 'Gates: wait, assert, human challenge',
  value: 'Move or wipe values without exporting them',
  page: 'Page affordances and authorised JavaScript',
};

export const VERBS = [
  { v: 'version', group: 'session', fields: [], note: 'Manifest version, build id, inst and permissions. Proves which code the worker loaded.' },
  { v: 'whoami', group: 'session', fields: [], note: 'Profile session: inst, windows, tab count, owned windows, run tags.' },
  { v: 'openWindow', group: 'session', fields: ['url', 'run', 'state', 'focused', 'width', 'height', 'left', 'top'], note: 'Opens a window carrying an ownership marker tab. Under dnd it opens minimised.' },
  { v: 'close', group: 'session', fields: ['run'], note: 'Closes only marker-carrying windows. Operator windows are reported untouched.' },
  { v: 'openTab', group: 'session', fields: ['url', 'windowId', 'window:{run}', 'active', 'loadTimeout', 'settle', 'requireLoaded'], note: 'Name the window explicitly when several are open.' },
  { v: 'closeTab', group: 'session', fields: ['tab', 'force'], note: 'Leaves an anchor tab when closing the last one, so the runner survives.' },
  { v: 'navigate', group: 'session', fields: ['tab', 'url', 'loadTimeout', 'settle', 'requireLoaded'], note: 'Waits for the navigation to start, then to complete.' },
  { v: 'history', group: 'session', fields: ['tab', 'action:back|forward|reload', 'loadTimeout'], note: 'Session history navigation; waits for load.' },
  { v: 'activate', group: 'session', fields: ['tab'], note: 'Raises tab and window. Refused under dnd: the verb IS the screen takeover.' },
  { v: 'hub', group: 'session', fields: ['url', 'active', 'open:false'], note: 'Anchor tab that keeps a window alive across closeTab.' },
  { v: 'reload', group: 'session', fields: [], note: 'Reloads the extension from disk. The connection drops; do not blind-retry.' },
  { v: 'sleep', group: 'session', fields: ['ms'], note: 'Capped at 20000 ms. Prefer waitFor over a blind sleep.' },

  { v: 'query', group: 'discover', fields: ['tab', 'sel', 'limit', 'text:true', 'frameId'], egress: 'text:true', note: 'Shape of every match: tag, id, class, box, visibility, text length. Field values are withheld.' },
  { v: 'frames', group: 'discover', fields: ['tab'], note: 'Frame inventory with frameId/parentFrameId and origin+path. Address a cross-origin iframe without a debugger.' },
  { v: 'getText', group: 'discover', fields: ['tab', 'sel', 'max', 'frameId'], egress: 'page text', note: 'Visible text of a node or the whole document, truncated to max.' },
  { v: 'getHTML', group: 'discover', fields: ['tab', 'sel', 'outer', 'max', 'frameId'], egress: 'page markup', note: 'Markup of a node or document. Masked field attributes are redacted.' },
  { v: 'screenshot', group: 'discover', fields: ['tab', 'format:jpeg|png', 'quality', 'maxWidth'], egress: 'page pixels', note: 'Visible tab, downscaled in the worker. Raises a background tab, so refused under dnd.' },

  { v: 'click', group: 'interact', fields: ['tab', 'sel', 'frameId'], note: 'Scrolls into view, clicks, reports the node it hit.' },
  { v: 'dblclick', group: 'interact', fields: ['tab', 'sel', 'frameId'], note: 'Full mouse sequence ending in dblclick.' },
  { v: 'rightClick', group: 'interact', fields: ['tab', 'sel', 'frameId'], note: 'contextmenu sequence for custom menus.' },
  { v: 'hover', group: 'interact', fields: ['tab', 'sel', 'frameId'], note: 'mouseover/enter/move without a click, for hover-revealed controls.' },
  { v: 'key', group: 'interact', fields: ['tab', 'sel', 'key', 'code', 'frameId'], note: 'DOM keyboard events. Not a native OS key press.' },
  { v: 'fill', group: 'interact', fields: ['tab', 'sel', 'literal', 'frameId'], note: 'Literal text only; sets the native value and fires input/change. Secret refs are refused.' },
  { v: 'select', group: 'interact', fields: ['tab', 'sel', 'value|label|index', 'frameId'], note: 'Chooses an <option> and fires input/change.' },
  { v: 'scroll', group: 'interact', fields: ['tab', 'sel', 'align', 'x', 'y', 'byX', 'byY', 'frameId'], note: 'Scrolls a node into view, or the window by/absolute offset.' },
  { v: 'mouseDrag', group: 'interact', fields: ['tab', 'sel', 'dx', 'dy', 'moves', 'frameId'], note: 'Interpolated mouse drag for sliders, canvases and sortable handles.' },
  { v: 'drag', group: 'interact', fields: ['tab', 'from:{sel}', 'to:{sel}', 'frameId'], note: 'HTML5 drag-and-drop between two nodes; reports whether a handler took it.' },
  { v: 'media', group: 'interact', fields: ['tab', 'sel', 'action:status|play|pause|mute|unmute|volume|rate|seek', 'value', 'frameId'], note: 'Controls a video/audio node and reports playback state; src is origin+path only.' },
  { v: 'uploadFile', group: 'interact', fields: ['tab', 'sel', 'name', 'mime', 'text|url|dataUrl', 'frameId'], note: 'Builds the file inside the page and assigns .files or synthesises a drop. No local filesystem access.' },
  { v: 'highlight', group: 'interact', fields: ['tab', 'sel', 'color', 'ms', 'frameId'], note: 'Temporary outline, for a human watching the run.' },

  { v: 'waitFor', group: 'verify', fields: ['tab', 'sel', 'timeout', 'grow', 'quiet', 'frameId'], note: 'grow waits for MORE matches than now; quiet waits for text to stop growing.' },
  { v: 'assert', group: 'verify', fields: ['tab', 'sel', 'has:text|value', 'eq', 'absent', 'frameId'], note: 'Existence or value gate. Answers len, never a field value.' },
  { v: 'captcha', group: 'verify', fields: ['tab', 'wait:true', 'timeout', 'frameId'], note: 'Detects a challenge and warns on screen. Never solves it; wait blocks for the human.' },

  { v: 'relay', group: 'value', fields: ['from:{tab,sel,frameId}', 'to:{tab,sel,frameId}'], note: 'Copies a value browser-side. Receipt carries length only.' },
  { v: 'move', group: 'value', fields: ['from:{tab,sel,frameId}', 'to:{tab,sel,frameId}'], note: 'Relay, then clears the source.' },
  { v: 'swap', group: 'value', fields: ['a:{tab,sel,frameId}', 'b:{tab,sel,frameId}'], note: 'Exchanges two values without either leaving the browser.' },
  { v: 'clear', group: 'value', fields: ['tab', 'sel', 'frameId'], note: 'Wipes a field so nothing lingers.' },
  { v: 'setStore', group: 'value', fields: ['tab', 'sel', 'value', 'remove:true', 'frameId'], note: 'Writes/deletes localStorage:KEY, sessionStorage:KEY or cookie:NAME; * clears the store. Counts only.' },
  { v: 'cookies', group: 'value', fields: ['tab|url|domain', 'action:list|set|remove', 'name', 'value', 'path', 'secure', 'httpOnly', 'sameSite', 'expires', 'limit'], note: 'Cookie metadata out, never values. A scope is mandatory; an unfiltered browser-wide read is refused.' },

  { v: 'inject', group: 'page', fields: ['tab', 'kind:button|overlay', 'id', 'text', 'anchor', 'copyFrom', 'css', 'frameId'], note: 'Adds an affordance. Its click emits an invoke event; it is not arbitrary JS.' },
  { v: 'script', group: 'page', fields: ['tab', 'code', 'world:USER_SCRIPT|MAIN'], note: 'One-shot authorised JavaScript (Chrome 135+, user-script permission). Return values never leave the browser.' },
];

export const VERB_NAMES = VERBS.map(x => x.v);
export const FAIL_CODES = ['no_tab_id', 'no_tab', 'no_frame', 'element_not_found', 'bad_matcher', 'page_not_scriptable',
  'assert_failed', 'page_not_loaded', 'unknown_verb', 'timed_out', 'field_empty', 'no_window', 'dnd_refused',
  'captcha_unsolved', 'screenshot_too_large', 'no_history', 'bad_action', 'bad_cookie_target', 'cookies_unavailable',
  'frames_unavailable', 'user_scripts_unavailable', 'invalid_script', 'script_error', 'secret_ref_unsupported',
  'bad_store_sel', 'store_key_absent', 'cookie_absent', 'aborted', 'skipped', 'busy', 'in_progress', 'id_conflict',
  'interrupted', 'invalid_command', 'execution_error', 'failed'];