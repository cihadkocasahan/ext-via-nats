# Architecture

## Topology

```text
┌──────────────────────────┐         ┌──────────────────┐         ┌───────────────────────────┐
│ Agent host               │         │ NATS broker      │         │ Browser host              │
│                          │  stdio  │                  │   WSS   │                           │
│  MCP-capable agent ──────────────► │  ws:// local     │ ◄──────────── Chrome MV3 extension  │
│                    scripts/mcp.mjs │  wss:// cloud    │         │   service worker          │
│                          │         │                  │         │        │                  │
│  CLI  scripts/remote.mjs │         │  subject ACL     │         │        ▼                  │
│         (same contract)  │         │  auth: token /   │         │   content script          │
└──────────────────────────┘         │  user+pass /     │         │   (every frame)           │
                                     │  .creds          │         │        │                  │
                                     └──────────────────┘         │        ▼                  │
                                                                  │   tabs / DOM / JS         │
                                                                  └───────────────────────────┘
```

Both ends dial **out** to the broker. The browser host opens no listening port, no
debug port and no HTTP control surface. That is the whole reason this works across
NAT, on a laptop behind a router, or on a machine you cannot reach inbound.

NATS is the transport, not the product. This repository is a worked example of
using NATS request/reply to drive a real browser, and a starting point for other
projects that need the same shape.

## Components

| Path | Role |
|---|---|
| `src/background.js` | MV3 service worker: NATS connection, register/heartbeat, command intake, ledger, abort. |
| `src/executor.js` | The verb executor. Runs steps across tabs and frames, produces non-secret receipts. |
| `src/protocol.js` | Shared contract: config validation, subject naming, command validation. Used by both ends. |
| `src/verbs.js` | The wire vocabulary in one place. The MCP catalog and the command reference are written from it. |
| `extension/content.js` | DOM operations in the page's isolated world, injected into every frame. |
| `extension/options.*` | Bilingual settings page: broker address, prefix, credentials, live status, profile identity. |
| `extension/harness.*` | Ownership marker tab. Its presence is what authorises closing a window. |
| `scripts/mcp.mjs` | MCP server over stdio. Seven tools. |
| `scripts/client.mjs` | Shared control client for MCP and CLI. |
| `scripts/remote.mjs` | CLI: list profiles, run a command file. |
| `infra/` | Local broker config and an ACL starting template. |

`extension/background.js` is **build output**. Edit `src/`, then run `npm run build`.

## Why not CDP / Playwright / a local HTTP relay?

| Approach | What it needs | What it costs |
|---|---|---|
| CDP (Playwright, Puppeteer) | A debug port on the browser host, or launching the browser itself | Inbound reachability; usually a fresh profile, so existing logins are gone |
| `chrome.debugger` extension API | The extension attached as debugger | A persistent "is being debugged" infobar; conflicts with DevTools |
| Local HTTP relay on the browser host | A listening port plus a tunnel | Another service to secure, another port to expose |
| **This project** | An outbound WebSocket to a broker both ends can reach | No inbound port, no debug infobar, keeps the user's real profile and sessions |

The trade-off is honest: you give up CDP's raw power (network interception, OS-level
input, full page lifecycle control) and you depend on a broker. In exchange you get
to drive a browser that is already signed in, on a machine you cannot connect to,
with authorisation enforced by the broker's subject ACL rather than by network
position.

## Identities

| Identity | Meaning |
|---|---|
| `inst` / `extViaNatsInst` | The extension's UUID for this Chrome profile, kept in local storage. **The only valid command target.** |
| command `id` | Idempotency key for one step sequence. |
| `run` | Ownership tag carried by a marker tab; scopes `openWindow` / `close`. |
| `windowId` / `tabId` | Chrome-internal targets, valid only inside that browser session. |

An email address is not a profile identity, and a profile folder name is not one
either. A cloned profile can clone the extension storage with it: do not run two
copies carrying the same `extViaNatsInst` against the same broker account.

The marker tab can be moved or closed by a human. Ownership proof in this version
is the tab's current location, not a native window-handle or PID check.

## Subjects

Default prefix `extvianats.browser`. Payloads are JSON. Commands, info and abort use real
NATS `request()`; the answer returns to the request's reply inbox. An arbitrary
`reply_to` inside the JSON is not honoured.

| Subject | Direction / payload |
|---|---|
| `extvianats.browser.discover` | Controller request → every extension answers with its session info |
| `extvianats.browser.cmd.<inst>` | Controller → `{id, steps, dnd?, follow?, onError?}` |
| `extvianats.browser.info.<inst>` | Controller → `{}`, session info returns |
| `extvianats.browser.abort.<inst>` | Controller → `{id}`, flags the matching running command |
| `extvianats.browser.register.<inst>` | Extension → profile and window metadata |
| `extvianats.browser.heartbeat.<inst>` | Extension → `{inst, label, running, timestamp}` |
| `extvianats.browser.stream.<inst>` | Extension → started / step / done metadata |
| `extvianats.browser.invoke.<inst>` | Injected button → `{id, inst, tabId}` event |

`discover` collects multiple answers inside a time window. The online list does not
depend on any past register message, so it survives a broker restart.

A five-second heartbeat plus NATS ping keeps the worker's connection alive; an
alarm retries when it drops. The NATS client re-subscribes after reconnect and the
profile registers again.

## Frames

The content script is injected with `all_frames: true`, and every DOM step carries
an explicit `frameId` (default `0`, the top frame). Use the `frames` verb to list
`frameId` / `parentFrameId` and address a cross-origin iframe directly.

This is deliberate: without an explicit frame, a message goes to every frame and
the first reply wins, which turns targeting into a lottery.

## Storage and authorisation

Config, identity and the last-100-command ledger live in `chrome.storage.local`;
transient connection state lives in `chrome.storage.session`. Local storage access
is restricted to `TRUSTED_CONTEXTS`. The ledger stores a SHA-256 of the command
content plus its receipt — not the raw command code, and not any value it moved.

Authentication is NATS token, user/password, or `.creds`. Authorisation is the
broker's subject ACL, which should be narrowed per profile. The extension's
`userScripts` permission is separate from broker authority: granting one does not
grant the other.

Credentials are entered by the user in the settings page and stay in that profile's
local extension storage. They are not sent to Chrome Sync and never travel in a
NATS message. That storage is not an OS password vault.

## What stays inside the browser

`relay`, `move` and `swap` read a value in one tab and write it in another without
the value ever being serialised out. Receipts carry a length, never the value.
`script` return values are not exported either — a page's return value could be a
token or a cookie.

Egress is opt-in and named: `query` with `text:true`, `getText`, `getHTML`,
`screenshot`. Everything else returns shape, counts and state. Cookie reads return
metadata only and require an explicit scope; an unfiltered browser-wide cookie read
is refused. Receipt URLs are reduced to origin + path, so query strings and
pre-signed media URLs do not leak.

## Optional alternatives

- **Broker**: any NATS server with a WebSocket listener. The Docker example here is
  loopback and unauthenticated, for local testing only. For anything reachable by
  others, use TLS and per-profile credentials (`infra/nats-auth.example.conf`).
- **Cloud**: a hosted NATS service reached over `wss://` with a `.creds` file. The
  settings page walks through obtaining one. A provider's REST/HTTP gateway is a
  different protocol and is not used here.
- **Controller**: MCP for agents, the CLI for scripts, or your own NATS client —
  all three speak the same command contract.
- **No broker at all**: not supported. The transport is the point of the example.
