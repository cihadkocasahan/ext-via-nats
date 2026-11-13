# Setup

Three things have to agree: the **broker address**, the **subject prefix**, and the
**authentication method**. The extension and the controller (MCP or CLI) are two
independent NATS clients; if any of the three differs, they simply never meet.

## Requirements

| Piece | Requirement |
|---|---|
| Browser | Chrome 120+ on Windows or Linux. `script` (real JavaScript) needs Chrome 135+ and the *Allow User Scripts* toggle. |
| Controller | Node.js 22+ |
| Broker | Any NATS server with a **WebSocket** listener enabled |
| Local broker helper | Docker (only for `npm run nats:local`) |

**No Chrome command-line flags are needed to use this project.** You install it as
an unpacked extension through the normal UI. The `--enable-unsafe-extension-debugging`
flag appears only in `scripts/test-chrome.mjs` and `scripts/live-session.mjs`, because
those harnesses install the extension over CDP instead of by hand.

## 1 · Build

```bash
npm ci
npm run build
```

`extension/background.js` and `extension/protocol.js` are build output. The sources
are `src/`. After editing `src/`, run `npm run build` again and reload the extension
in `chrome://extensions`.

## 2 · Start a broker

### Option A — local Docker (fastest)

```bash
npm run nats:local     # start
npm run nats:stop      # stop
```

This starts a container named `ext-via-nats-nats` and publishes **only on loopback**:

```text
ws://127.0.0.1:18222   →   container WebSocket port 8222
```

It does not touch any existing NATS service on 4222/8222. The broker is
unauthenticated and loopback-only: fine for trying the project out, not for anything
another machine can reach.

### Option B — your own `nats-server`

```bash
nats-server -c infra/nats-local.conf
```

That config listens on loopback with client TCP `4222` and WebSocket `8222`, so the
extension URL is `ws://127.0.0.1:8222`.

> **Pick the WebSocket port deliberately.** It is the value inside
> `websocket { port … }`. In a stock `nats-server`, `8222` is the *monitoring HTTP*
> port and WebSocket is disabled entirely; `4222` is the *native client TCP* port.
> Neither speaks WebSocket. Pointing the extension at one of them produces a
> connection that never succeeds.

### Option C — a broker you already run

Use its WebSocket address. For another device on the LAN, loopback is not enough:
the broker needs a reachable listener, a firewall rule, TLS and authentication.
Start from `infra/nats-auth.example.conf` (see §7).

## 3 · Install the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this project's `extension/` folder.
4. Repeat for every Chrome profile you want to control. Each profile gets its own
   identity and its own settings.

The manifest carries a fixed public key, so the extension id is the same on Windows
and Linux: `ncfgllpgnoapgbomonfhbmhlcffmmnba`. Do not change the key.

## 4 · Fill in the settings page

Open the extension's options (toolbar icon → options, or
`chrome-extension://<id>/options.html`). The page is bilingual — **English / Türkçe**
switch at the top right.

Pick a preset first:

- **Local or your own server** — fills `ws://127.0.0.1:8222` if the field is empty
  and shows the local broker commands.
- **NATS Cloud** — fills `wss://connect.ngs.global:443` and shows the account
  steps. That public endpoint answers a real NATS handshake over WebSocket; your
  `.creds` still authenticates you. If your account panel lists a different
  WebSocket address, use that one instead (see §6).

Then set:

| Field | Value |
|---|---|
| Label | A human name for this profile, e.g. `work-laptop`. Shown in discovery. |
| NATS URL | `ws://HOST:WS_PORT` or `wss://HOST:PORT` |
| Subject prefix | Default `extvianats.browser`. Must match the controller. |
| Authentication | Exactly one of: token, user + password, or `.creds` **content** |
| Enable | On, then **Save** |

The status line reports the live connection state and shows this profile's `inst`.
**Copy that `inst`** — it is a per-profile UUID and the only valid command target.
An email address is not an identity, and neither is a profile folder name.

Credentials are stored in that profile's local extension storage, readable only by
trusted extension contexts. They are not sent to Chrome Sync and never travel in a
NATS message. That storage is not an OS password vault.

## 5 · Enable real JavaScript (optional)

`script` runs user-authored JavaScript through `chrome.userScripts`. Chrome gates it
behind a toggle:

1. `chrome://extensions` → this extension → **Details**.
2. Turn on **Allow User Scripts**.

This is a UI toggle, not a command-line flag. With it off, every DOM verb still
works and `script` returns a permission error. Granting it restarts the extension,
so wait for the settings page to report *connected* again before sending commands.

## 6 · NATS Cloud

The two reference pages are:

- [Quick start](https://docs.synadia.com/cloud/user-guides/quick-start) — create an
  account, create a user, download the `.creds` file.
- [HTTP Gateway](https://docs.synadia.com/cloud/http-gateway) — **not used here.**

Steps:

1. Sign in and create an **Account**.
2. Create a **User** in that account.
3. Open the user's **Get Connected** panel and download the `.creds` file.
4. The NATS URL field is already prefilled with `wss://connect.ngs.global:443`.
   If your account's **Get Connected** panel shows a different WebSocket endpoint,
   replace the prefilled value with it.
5. Paste the `.creds` file's **content** into the extension's credentials field.
   The CLI and MCP server instead take a file **path** (`EXT_VIA_NATS_CREDS`).

Two honest caveats:

- The quick-start page shows `tls://connect.ngs.global`. That is the **native NATS
  client** address, which a browser cannot open. This extension speaks NATS **over
  WebSocket**, so the cloud preset fills `wss://connect.ngs.global:443` — the same
  host on its TLS port. That address was checked with an unauthenticated NATS INFO
  handshake and does answer over WebSocket; it is not a guess. Authentication is
  still yours: without a valid `.creds` the broker rejects the connection. Neither
  the TCP (4222) nor the monitoring (8222) port speaks WebSocket.
- The HTTP Gateway is a REST/HTTPS interface with `Authorization: Bearer` tokens.
  It is a different protocol from NATS request/reply over WebSocket and is not part
  of this project.

Cloud use needs a WebSocket/TLS listener and account permissions that allow the
subjects in `docs/architecture.md`. A provider's TCP address is never auto-converted
into a WSS address here.

## 7 · Controller configuration

### MCP

`examples/mcp.json` holds two ready server entries (local and cloud). Copy the one
you need into your MCP client's configuration and make the `args` path **absolute**:

```json
{
  "mcpServers": {
    "ext-via-nats": {
      "command": "node",
      "args": ["/absolute/path/to/ext-via-nats/scripts/mcp.mjs"],
      "env": {
        "EXT_VIA_NATS_URL": "ws://127.0.0.1:18222",
        "EXT_VIA_NATS_PREFIX": "extvianats.browser"
      }
    }
  }
}
```

The server speaks MCP over **stdio**; stdout carries only protocol traffic.
Registering it does not by itself run any browser command.

| Tool | Purpose |
|---|---|
| `ext_via_nats_verbs` | The verb catalog: every `v`, its fields, its group, which verbs return page data, and the stable failure codes. Call it before composing steps. |
| `ext_via_nats_profiles` | Discover connected profiles and their exact `inst` ids. |
| `ext_via_nats_info` | One profile's windows, owned windows, run tags, running command. |
| `ext_via_nats_command` | Run a step sequence in one exact profile. |
| `ext_via_nats_script` | Run JavaScript in one exact profile and tab. Return values never leave the browser. |
| `ext_via_nats_screenshot` | Capture a tab's visible area, downscaled in the extension to fit a NATS payload. |
| `ext_via_nats_abort` | Stop the running command at the next step boundary; cleanup steps still run. |

### Environment variables

| Variable | Meaning |
|---|---|
| `EXT_VIA_NATS_URL` | `ws://HOST:WS_PORT` or `wss://HOST:PORT` |
| `EXT_VIA_NATS_PREFIX` | Subject prefix, default `extvianats.browser` |
| `EXT_VIA_NATS_TOKEN` | Broker token |
| `EXT_VIA_NATS_USER` / `EXT_VIA_NATS_PASS` | Broker user and password |
| `EXT_VIA_NATS_CREDS` | Path to a local `.creds` file (CLI/MCP only) |

Use exactly one authentication method. The extension takes `.creds` **content**;
the controller takes a **path**.

### CLI

```bash
export EXT_VIA_NATS_URL='ws://127.0.0.1:18222'
npm run remote -- list
npm run remote -- run PROFILE_INST examples/probe.json
```

On Windows PowerShell use `$env:EXT_VIA_NATS_URL = 'ws://127.0.0.1:18222'`.
`PROFILE_INST` is the real UUID from the settings page. `examples/probe.json` only
runs `version`/`whoami`; `examples/browser.json` opens a page.

### Agent flow

List profiles → pick the exact `inst` → confirm with `version`/`whoami` → run steps.
Use a **new command id for new work**. Reusing an id with identical content returns
the stored result instead of executing again.

## 8 · Harden the broker

The local example has no authentication. Before anything else can reach the broker,
start from `infra/nats-auth.example.conf`:

1. Replace `profile-uuid` with each extension's real `inst`.
2. Supply the passwords as environment variables to `nats-server`
   (`EXT_VIA_NATS_CONTROLLER_PASSWORD`, `EXT_VIA_NATS_BROWSER_PASSWORD`).
3. Add TLS. The template ships `no_tls: true` for loopback only.
4. Validate: `nats-server -t -c your.conf`.

The template gives the controller publish rights on `cmd/abort/info/discover` and
each browser profile rights only on its own subjects. **Broker authority is the
real security boundary**: a controller credential that can publish to a profile's
`cmd` subject can drive that browser. The approval reminder in the MCP tool
description is guidance for the agent, not a cryptographic gate.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `no responders` | No extension is subscribed on that subject. Check the profile is open, the extension enabled, and that URL **and prefix** match on both ends. NATS Core has no offline queue: a command sent while nobody listens is lost, not queued. |
| Status never reaches *connected* | Usually a wrong port (TCP 4222 or monitoring 8222 instead of the WebSocket port), missing TLS on `wss://`, or rejected credentials. |
| `busy` / `in_progress` | One command per profile at a time. `in_progress` means that same id is still running. |
| `id_conflict` | The id was already used with different content. Use a new id. |
| `interrupted` | A previous run with this id has an uncertain outcome. It is deliberately not re-executed; query state before deciding. |
| `script` permission error | *Allow User Scripts* is off, or Chrome is older than 135. |
| `screenshot_too_large` | The captured image exceeded the in-worker budget even after downscaling. Capture a smaller area. |
| Extension vanished after `reload` | `reload` re-reads the extension from disk. An extension installed over CDP by a test harness is not persisted in the profile; install it through **Load unpacked** for normal use. |

After a timeout, do not blind-retry with a new id. Re-send the **same id with the
same content** to read the stored outcome, or call `ext_via_nats_info` first.
