# Hermes Mobile — Expo port

A Grok-style bot control surface for Hermes hosts, rebuilt as an Expo React Native (TypeScript) app plus a Rust Axum gateway proxy. **Remote control surface only — never an agent runtime.** It embeds no model, provider credential, agent runtime, shell, or tool executor. The Hermes host remains the sole execution authority.

> Status: **v1 scaffold, host-unverified.** TypeScript is clean, unit tests pass, and the Android JS bundle exports — but **no live Hermes host connection has been tested yet**. Do not call this production-ready against a live host until a real host connection is tested (see "Device test" below). Several features are honest stubs, listed under "Stub vs live".

## What is built

**Expo app (SDK 58, Expo Router, TypeScript, Hermes JS engine, FlashList)**
- Tabs: Bots · Sessions · Tasks. Settings is a header action, not a tab.
- Routes: `chat/[sessionId]`, `group/[groupName]`, `bot/[profile]/settings|capabilities|routines|computer`, `bot/new` (wizard: role → identity → SOUL → model → appearance, opens the canonical chat on creation), `chat/new`, `group/new`, `tasks/new`, `tasks/[jobId]`, `settings/*`, `(modals)/clarify|approval`.
- One durable `/api/ws` NDJSON JSON-RPC connection per host (15 s open+ready, `gateway.ready` pinned, id-routed RPC, terminal set `message.complete`/`turn.end`/`turn.error`/`turn.failed`/`error`, clarify answered or `{}` if unparseable, unknown server methods answered `-32601`, never auto-resubmit even if `safe_to_resubmit`, silence watchdog reconciling from the host transcript).
- Turn journal: intent persisted **before** `prompt.submit`; write failure sends zero prompts; resend is an explicit user action only.
- Auth: device credentials in SecureStore only (never AsyncStorage); `127.0.0.1`/`localhost` rejected as a phone gateway URL; a remote gateway with `auth_required !== true` is refused with the spec's message. No provider credentials in the app, ever.
- Roster from `profiles.list` (`include_sessions: true`) — never from the sessions projection; canonical session `resolved_id || id`; groups derived from `ui_meta['hermes-bots'].groups`, membership written first, then `groups.create`; driver-less rooms are read-only.
- Tasks: Running / Scheduled / Paused-attention, blueprint + custom create, prompt editor, pause/resume/trigger/delete with confirm, optimistic rollback on failure.
- Glass UI: dark-first tokens (dark bg `#1c1c1e`, light `#faf9f7`, accent `#0067d9`), Tier-1 glass components vendored own-the-source in `src/components/glassyui/` (reimplemented, MIT-attributed — see its README and `THIRD_PARTY_NOTICES.md`). **Light-mode jade `#14a874` is never used as text (2.90:1)** — dot/badge fill only. Glass only on the floating layer (tab bar / composer / sheet); content surfaces are opaque tiles. No raw hex outside `src/theme/tokens.ts`.
- Security fix vs the upstream APK: **cleartext is OFF by default** — no `usesCleartextTraffic` anywhere. The upstream APK shipped `usesCleartextTraffic=true`; this port does not carry it over. Tailscale-first: phone and host on the same tailnet, never expose port 9119 publicly.

**Rust gateway proxy (`gateway/`, single binary `hermes-gateway`)**
- Runs **next to the Hermes host** and forwards to it: REST passthrough, `/api/ws` NDJSON proxy with bounded channels (128) and real backpressure (slow phone pauses upstream reads, no unbounded buffering), `/api/status` probe, WS tickets (30 s, single-use), device-bearer auth on every request, attachment intake (25 MB cap → host `file.attach`), Expo push (metadata only, quiet hours 22:00–07:00 enforced proxy-side, disabled unless tokens are configured).
- Default listen `127.0.0.1:9120` on the host side; `0.0.0.0` refused without `HERMES_ALLOW_PUBLIC_BIND=1`. See `gateway/README.md` for build/run/config.
- **Not compiled locally** (no cargo on the dev machine) — `gateway-check.yml` (fmt, clippy `-D warnings`, test, release build) is its compile gate.

**CI (`.github/workflows/`)**
- `android-release.yml`: push to `main`, tags `v*`, PRs → Node 22, `npm ci`, typecheck, tests, manifest sanity (scheme `hermes`, package `com.hermesagent.mobile`, no `cleartext`), bundle-size guard, Expo prebuild, Gradle `assembleDebug`, debug APK artifact (30 days, non-PR only). Debug signing only — release signing needs Galih's keystore and is out of v1.
- `lint-gates.yml`: failing gates for raw hex outside token files, GlassSurface-without-GlassBackdrop, and light jade as text.

## Stub vs live (honest)

| Area | State |
|---|---|
| Gateway client, roster, chat, groups, tasks, capabilities, bot settings, connection probe, turn journal | Live code, **host-unverified** (no live host tested) |
| Native PKCE exchange | **STUB — pairing stores a placeholder SecureStore credential. Do not ship pairing until the real exchange is built.** |
| First-pairing probe vs proxy auth ordering | **Unresolved conflict**: gateway requires a device credential on `/api/status`, but before pairing there is no token, so the app's probe goes out unauthenticated (fine direct-to-host, 401 via proxy). Decide before release. |
| `turn.recover` / `turn.status`, exact approval-request method name | **Unconfirmed** against a live host's `gateway.ready` — client reconciles from transcript instead; approval modal does not yet resolve a live pending request |
| Display viewer | v1 = thumbnail + read-only fallback only; **no take-control affordance** (no native VNC component verified; gateway RFB bridge likewise stubs frame forwarding behind a real lease gate) |
| Voice STT / recording, attachment file picker | Not wired; composer tap inserts a clearly-labelled placeholder draft |
| App-side push delivery, tablet three-pane layout | Not implemented |
| Gateway compile, native Android build | Not run locally (no cargo / Android SDK here) — CI is the gate |

## Device test — exact next step for Galih

1. Wait for the CI run on this push: `android-release.yml` must go green and publish the `hermes-mobile-expo-debug-apk` artifact. Download and install that debug APK on his Android phone.
2. On his Hermes host machine, build and run the gateway next to Hermes: `cd gateway && cargo build --release && HERMES_ORIGIN=http://127.0.0.1:9119 HERMES_DEVICE_TOKEN=<a fresh token> ./target/release/hermes-gateway` (see `gateway/README.md` for the full config).
3. Phone + host on the same Tailscale tailnet. In the app: Settings → Connection, enter the gateway's tailnet address (never `127.0.0.1` on the phone), probe `/api/status`, and sign in — **expect the pairing/PKCE step to be the first failure point** (it is the known stub above); report the exact probe/sign-in result, and the `gateway.ready` payload, so the stub can be finished against the real host.
4. Then verify, in order: roster loads, a Bot Chat opens and streams, Stop works, a task lists, and a backgrounded turn reconciles on return. Performance bar from the design contract: cold start < 2.5 s, tap → chat < 300 ms, 60 fps scroll — measure on the phone, not an emulator.

## Attribution and licence

- Licence: **AGPL-3.0** (`LICENSE`). Upstream is AGPL-3.0 and this port keeps that licence; do not re-licence it permissively.
- Upstream attribution: Hermes Mobile by CodeUpdaterBot (AGPL-3.0, Tauri + React app this port reimplements from its protocol contracts); Hermes Agent by Nous Research; `rusty4444/hermes-android` Remote Gateway work (issue #81) whose contract this port follows. **Hermes Mobile is an independent community project, not affiliated with or endorsed by Nous Research.**
- Glass components in `src/components/glassyui/` are inspired by alexburlis/glassyui (MIT), reimplemented for this repo — see that directory's README and `THIRD_PARTY_NOTICES.md`.
- Full build notes: `BUILD-NOTES.md`.

## Develop

```sh
npm ci
npm run typecheck   # tsc --noEmit
npm test            # vitest, 53 tests
npm start           # Expo dev server
```
