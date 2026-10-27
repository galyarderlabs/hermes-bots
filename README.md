# Hermes Bots

[![Android CI](https://github.com/galyarderlabs/hermes-bots/actions/workflows/android-release.yml/badge.svg)](https://github.com/galyarderlabs/hermes-bots/actions/workflows/android-release.yml)
[![Gateway CI](https://github.com/galyarderlabs/hermes-bots/actions/workflows/gateway-check.yml/badge.svg)](https://github.com/galyarderlabs/hermes-bots/actions/workflows/gateway-check.yml)
[![Lint](https://github.com/galyarderlabs/hermes-bots/actions/workflows/lint-gates.yml/badge.svg)](https://github.com/galyarderlabs/hermes-bots/actions/workflows/lint-gates.yml)
[![Latest release](https://img.shields.io/github/v/release/galyarderlabs/hermes-bots)](https://github.com/galyarderlabs/hermes-bots/releases)
[![License: AGPL-3.0](https://img.shields.io/github/license/galyarderlabs/hermes-bots)](LICENSE)
[![Platform: Android](https://img.shields.io/badge/platform-Android-3DDC84)](https://github.com/galyarderlabs/hermes-bots/releases)

A Grok-style bot control surface for Hermes hosts. Talk to your bots, manage
sessions and scheduled tasks, and review approvals — from your phone, while
your Hermes host stays in charge.

> **Status: preview.** The core client is implemented and the Android build
> is green, but a live Hermes host connection has not been verified yet.
> See [Current limitations](#current-limitations) before relying on it.

## What it does

- **Bots** — roster, search, profiles, capabilities, and routines.
- **Live chat** — streamed bot replies over a single durable WebSocket
  (`/api/ws`, JSON-RPC), with turn journaling: an intent is persisted
  before it is sent, and a failed write sends nothing.
- **Group chats** — several bots in one conversation, each reply attributed
  to its sender.
- **Sessions** — the full runtime session projection, including read-only
  sessions held elsewhere.
- **Tasks** — scheduled and recurring bot work, with pause, resume,
  trigger, and delete.
- **Approvals & clarifications** — review bot questions and sensitive
  actions before they run.
- **Computer view** — read-only host display thumbnail (take-control is
  not implemented yet).

## How it works

Hermes Bots is a **remote control surface, not an agent runtime**. It runs
no model, holds no provider credentials, and executes no tools. The Hermes
host remains the sole authority for agents, credentials, approvals, tools,
sessions, files, and history.

- **App** — Expo React Native (TypeScript, Expo Router, FlashList, Hermes
  JS engine), glass UI with a dark-first design system.
- **Gateway** — a small Rust (Axum) proxy that runs next to the Hermes
  host and forwards REST and WebSocket traffic to it, with bounded
  backpressure, single-use WebSocket tickets, and metadata-only push.
- **Connection** — Tailscale-first. Phone and host join the same tailnet;
  port 9119 is never exposed publicly, cleartext traffic is off by
  default, and device credentials live only in SecureStore.

## Install

Download the latest debug APK from
[Releases](https://github.com/galyarderlabs/hermes-bots/releases),
uninstall any older preview first, then install the APK on Android.

Then, on the Hermes host machine, build and run the gateway:

```sh
cd gateway
cargo build --release
HERMES_ORIGIN=http://127.0.0.1:9119 HERMES_DEVICE_TOKEN=<a fresh token> \
  ./target/release/hermes-gateway
```

See [`gateway/README.md`](gateway/README.md) for the full configuration.

In the app, go to **Settings → Connection**, enter the gateway's tailnet
address (never `127.0.0.1` on the phone — that points back at the phone),
probe `/api/status`, and sign in.

## Develop

```sh
npm ci
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm start           # Expo dev server
```

Continuous integration runs typecheck, tests, manifest checks, lint gates,
a Rust gateway check (fmt, clippy, tests, release build), and an Android
debug build on every push to `main`.

## Current limitations

| Area | State |
|---|---|
| Gateway client, roster, chat, groups, tasks, capabilities, bot settings, connection probe, turn journal | Implemented, host-unverified |
| Native PKCE pairing | Stub — pairing stores a placeholder credential; do not rely on it yet |
| Pre-pairing probe vs proxy auth ordering | Unresolved: the gateway requires a device credential on `/api/status`, but no token exists before pairing, so a probe via the proxy returns 401 (direct-to-host works) |
| `turn.recover` / `turn.status`, exact approval method name | Unconfirmed against a live host's `gateway.ready`; the client reconciles from the transcript instead |
| Display viewer | Thumbnail + read-only fallback only, no take-control |
| Voice input, file picker, app-side push, tablet three-pane layout, final app icon | Not implemented yet |
| Release signing | Preview builds are debug-signed only |

## License and attribution

- License: **AGPL-3.0** — see [LICENSE](LICENSE). The upstream project is
  AGPL-3.0, and this port keeps that license.
- Upstream: Hermes Mobile by CodeUpdaterBot, a Tauri + React client whose
  protocol contracts this port reimplements; Hermes Agent by Nous Research;
  `rusty4444/hermes-android` remote-gateway work, whose contract this port
  follows. This is an independent community project, **not affiliated with
  or endorsed by Nous Research**.
- Glass components in `src/components/glassyui/` are inspired by
  [alexburlis/glassyui](https://github.com/alexburlis/glassyui) (MIT) and
  reimplemented for this repo — see `src/components/glassyui/README.md`
  and `THIRD_PARTY_NOTICES.md`.
- Build notes: [BUILD-NOTES.md](BUILD-NOTES.md).
