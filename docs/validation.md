# Validation record — 13 November 2026

Everything below was measured on this repository. Anything not listed here is
**not** claimed as verified.

## Measured

| Environment / action | Result |
|---|---|
| Windows host, Node v24.22.1: `npm run build` | Success — `extension/background.js` and `extension/protocol.js` regenerated from `src/` |
| Windows host: `npm test` | **2 / 2 pass**, 0 fail (~5.4 s) |
| Integration test against a real NATS 2.11.9 broker over WebSocket | Pass — isolated profiles, receipts, idempotency, abort, worker restart, MCP |
| Protocol test: local/cloud endpoint and subject boundaries | Pass |
| MCP over stdio (`initialize`, `tools/list`, `tools/call`) with a real MCP client | **7 tools** exposed; command execution succeeded |
| Verb catalog consistency (`src/verbs.js`) | **41 verbs**, 6 groups, 36 stable failure codes |
| `nats-server -t -c infra/nats-auth.example.conf` (NATS 2.11.9 container) | Configuration valid |
| Live Chrome acceptance on Windows, throwaway isolated profile | **9 / 9 checks pass** |
| Cloud WebSocket endpoint `wss://connect.ngs.global:443` | Real unauthenticated NATS INFO handshake: server 2.15.3, `auth_required: true`, `tls_required: true`, `jetstream: true` |

The integration test mocks the Chrome APIs inside a sandboxed worker: no browser
binary is launched and no real user profile is opened. It does verify NATS routing
between two separate workers/profiles, that a repeated command id is not
re-executed, that a changed payload under the same id returns `id_conflict`, abort
at a step boundary, result persistence across a worker restart, and that neither a
DOM secret nor a `script` return value reaches the NATS receipt.

### Live Chrome acceptance checks (Windows)

Run with `npm run test:chrome` against a disposable profile created under the
gitignored scratch directory — never a daily-use browser profile.

1. `options-ui-and-nats-connection` — settings page renders, saves, and reaches *connected*
2. `profile-discovery` — the profile is discoverable with its exact `inst`
3. `mcp-version-and-whoami` — MCP tools drive `version` / `whoami`
4. `real-dom-fill-assert-click` — real page, real fill, assert and click
5. `browser-only-value-relay` — a value moves browser-side; the receipt reports length, not the value
6. `injected-button` — `inject` adds a working element to a real page
7. `real-javascript-user-script` — `script` executes through `chrome.userScripts` with *Allow User Scripts* on
8. `owned-window-marker` — a run-owned window is marked
9. `owned-window-cleanup-preserves-fixture` — cleanup closes only owned windows and leaves the fixture intact

Because NATS Core has no offline queue, the harness waits for **three consecutive
spaced `info` answers** before issuing further commands (observed at 0 ms, 2012 ms,
4028 ms). A single answer can come from a worker that is about to die, and a command
published in that gap is lost rather than queued.

### Two harness findings worth knowing

- **No Chrome command-line flag is needed to use this project.** The
  `--enable-unsafe-extension-debugging` flag exists only in the test harnesses,
  which install the extension over CDP instead of by hand. Normal use is
  **Load unpacked** through `chrome://extensions`.
- **`reload` is harmful for a CDP-installed extension.** That install is not
  persisted in the profile, so `chrome.runtime.reload()` leaves the extension
  disabled and its own pages fail with `net::ERR_BLOCKED_BY_CLIENT`. Granting
  *Allow User Scripts* already restarts the extension; the harness therefore does
  not call `reload`.

## Not verified

1. **Linux Chrome live acceptance.** The control layer is portable Node and the
   test suite is platform-independent, but no Linux browser run is recorded here.
2. **An authenticated cloud session.** The cloud endpoint was probed
   *unauthenticated* only. No real account, `.creds` file or cloud command round
   trip was exercised.
3. **Subject ACL negative tests** against a live authenticated broker. The example
   config passes syntax validation; its permission boundaries were not attacked.
4. **NAT / WAN traversal** between two separate networks, and recovery from a
   prolonged connection loss.
5. **A daily-use browser profile.** All live runs used disposable profiles.

## Out of scope in this version

OS-level browser launching, profile-to-email inventory, external secret-slot
services, persistent page-script registries and playbook bindings are not part of
this repository. There is no pairing, JWT or hub protocol: **authorization is
enforced by NATS subject ACLs**, and nothing else.