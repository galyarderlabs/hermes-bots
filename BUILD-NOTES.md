# BUILD-NOTES

Build notes from the port agents. Each agent appends its own headed
section; never overwrite another agent's section.

## Gateway (Rust Axum proxy)

Scope: `app/gateway/` only (plus this section). No Expo app files,
no `.github/` files, and no pushes were touched by the gateway agent;
the coordinator merges and pushes.

### What was built

Single-binary Axum proxy (`hermes-gateway`) that runs next to the
Hermes host and forwards to it. Clean-room from
`analysis/port-spec.md` §5–§6 and §9–§10; no upstream Tauri Rust
source copied.

- `app/gateway/Cargo.toml` — binary crate `hermes-gateway` 0.1.0.
  Deps: axum 0.8 (`ws`, `multipart`), tokio 1 (`full`),
  tower-http 0.6 (`trace`), reqwest 0.12 (`json`, `rustls-tls`),
  tokio-tungstenite 0.26 (default features only — see the `wss://`
  note below), futures-util 0.3, serde 1 + serde_json 1,
  tracing 0.1 + tracing-subscriber 0.3 (`env-filter`, `fmt`),
  base64 0.22, bytes 1, rand 0.8, hex 0.4, subtle 2, http 1,
  chrono 0.4.
- `app/gateway/src/main.rs` — config load, push-watcher spawn,
  router assembly (public `/healthz`, protected REST router with
  device-auth + rate-limit middleware, WS routes), graceful shutdown.
- `app/gateway/src/config.rs` — env-over-file-over-default config.
  `HERMES_ORIGIN` required; default listen `127.0.0.1:9120`;
  `0.0.0.0`/`[::]` refused unless `HERMES_ALLOW_PUBLIC_BIND=1`;
  device token required unless `HERMES_TRUST_PROXY_AUTH=1`. Push keys
  in the config file are warned-and-ignored (push is env-only).
- `app/gateway/src/auth.rs` — device bearer verification
  (constant-time over equal lengths, via `subtle`),
  `POST /api/auth/ws-ticket` (single-use, 30 s), `POST /api/auth/revoke`
  (in-memory; restart restores the env token — permanent revocation
  means rotating `HERMES_DEVICE_TOKEN`).
- `app/gateway/src/proxy.rs` — REST passthrough (status, profiles/
  sessions, sessions, model, audio, cron, host auth), display-ticket
  minting, and multipart attachment intake → host `file.attach`
  (one bounded buffer, one base64 pass, 120 s upstream RPC, host
  reply verbatim). Phone credentials are stripped; the host
  credential is attached server-side. Auth routes additionally
  forward the host session cookie and `Set-Cookie` verbatim.
- `app/gateway/src/ws.rs` — `/api/ws` NDJSON JSON-RPC proxy
  (verbatim forwarding, single writer per direction, bounded mpsc
  channels default 128 with real backpressure, backoff dial,
  bearer-or-ticket auth, per-connection rate bucket) and the
  `/api/display/ws` RFB bridge stub (ticket + single-holder lease
  gate real; frame forwarding TODO(RFB)).
- `app/gateway/src/push.rs` — Expo Push Service watcher
  (metadata-only: Bot name + generic body + `{kind, id}`; quiet
  hours 22:00–07:00 and per-Bot gates enforced proxy-side; disabled
  with one log line when no tokens are configured).
- `app/gateway/src/ratelimit.rs` — per-credential-hashed token
  bucket for REST (`429` + `Retry-After`), per-connection bucket
  for WS (exhaustion closes the connection, never silent drop).
- `app/gateway/src/state.rs` — shared state: config, HTTP client,
  single-use tickets, refcounted live-session registry (push
  suppression only), display holder, revocation flag.
- `app/gateway/README.md` — build/run/config reference, security
  posture (Tailscale-first, cleartext OFF for the phone path,
  loopback-only proxy→host hop documented separately), stub-vs-live
  table, and the CI verification note.
- `app/gateway/config.example.json` — placeholder config (no real
  secrets).

### Live vs stub (honest)

- LIVE code (needs a real Hermes host to verify end-to-end):
  REST passthrough, WS proxy, ticket minting/revocation,
  attachment intake, push watcher (disabled unless
  `HERMES_PUSH_TOKENS` is set).
- STUB: RFB bridge frame forwarding — ticket + lease gate are real,
  holder frames are logged and dropped, no RFB bytes fabricated.
  Marked `TODO(RFB)` in `src/ws.rs`.
- CONDITIONAL: turn re-attach — only if the host's `gateway.ready`
  advertises `turn.recover`/`turn.status`; otherwise the client
  reconciles from the transcript endpoint. The proxy logs what
  `gateway.ready` advertised and never calls an unadvertised method.
  No `turn.recover` method was invented (spec §13 open question).

### Deliberate design decisions (for the coordinator / Expo agent)

1. `/api/status` requires the device credential (only `/healthz` is
   unauthenticated). Rationale: the task requires device verification
   on every request; the phone's probe therefore sends URL + device
   token together. The host's `auth_required` refusal rule from
   spec §6 still applies to what the host reports inside the
   proxied body.
2. `POST /api/auth/ws-ticket` mints the PROXY's ticket, not the
   host's. The proxy attaches the host credential server-side when
   dialling upstream, so the phone never needs a host ticket.
3. Upstream WS auth (v1 assumption): the host WS accepts the same
   bearer credential as REST, sent as an `Authorization` header. If
   the real host requires ticket auth for WS instead, this needs a
   follow-up before release.
4. Upstream is assumed `ws://` (loopback). `wss://` needs a TLS
   feature on tokio-tungstenite (see CI notes in the gateway README).
5. Mid-connection upstream loss tears the mobile socket down (1011
   on dial exhaustion) so the client re-resumes cleanly, instead of
   a transparent reconnect that could duplicate or skip a turn.
   Backoff reconnect applies to the dial and to the push watcher.
6. This checkout (`app/`) is not a git repository on this machine
   (no `.git` found), so nothing was committed or pushed here, per
   the task. The coordinator owns merge + push.

### NOT verified locally (CI must gate)

- Cargo is NOT installed on this dev machine, so the gateway was
  NOT compiled or tested locally. No live Hermes host is available
  from this machine, so no end-to-end verification was claimed.
- CI commands (from `app/gateway/`):

```sh
cargo build --release
cargo test
cargo fmt --check
```

- Compile-risk notes for the CI reader (also in gateway README):
  axum 0.8 `Message::Text` = `Utf8Bytes` (converted via deref /
  `.into()` in `ws.rs`); upstream WS dial with an `Authorization`
  header via `http::Request::builder().body(())` into
  `tokio_tungstenite::connect_async` (its `IntoClientRequest` impl
  for `http::Request<()>`); `axum::body::to_bytes(body, limit)` and
  the `{*rest}` wildcard route syntax (axum 0.8 surface). Unit
  tests included: config helpers, quiet-hours logic, token bucket.

## Expo app (React Native)

Scope: Expo app files only (no `gateway/`, no `.github/`, no pushes;
the coordinator merges and pushes). Clean-room implementation from
`../analysis/port-spec.md` and `../analysis/design-contract.md` — no
upstream source code copied. No live Hermes host was available, so
nothing here is verified against a live host — see STUB/UNVERIFIED
below. Do not present this as production-ready against a live host.

### Verified locally

- `npm run typecheck` — clean (`tsc --noEmit`).
- `npm test` — 7 files, 53 tests, all passing (vitest).
- `npx expo config --type public` — validates; SDK 58.0.0, app name
  `Hermes`, slug `hermes-bots`, scheme `hermes`, Android package
  `com.hermesagent.mobile`, version 0.3.0.
- `npx expo export -p android` — succeeds; Android Hermes bytecode bundle
  produced (2.9 MB `.hbc`). This is a bundling check, not a native build.
- `npx expo export --dry-run` does NOT exist in Expo SDK 58 (unknown
  argument) — the export above is the replacement check.
- Prebuild / native Android build NOT attempted: no Android SDK is
  installed in this environment. That step still needs a machine with
  the Android SDK; it is not faked here.
- Raw-hex audit: no hex literals outside `src/theme/tokens.ts`
  (verified by grep over `app/` and `src/`).
- Real lockfile: `npm install` was run, so `package-lock.json` is real.
  Installed: Expo 58.0.19, expo-router 58.0.26, React Native 0.88.0,
  React 19.3.1, Reanimated 4.7.1, FlashList 2.3.3.
  - SDK note: expo-router 58 removed the `expo-router/babel` package
    export (Metro fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` if it is
    listed). `babel.config.js` therefore uses `babel-preset-expo` only
    plus `react-native-reanimated/plugin`; the router transform is
    handled by the preset. This is documented in the babel config.
  - FlashList 2.x removed `estimatedItemSize`; the thread relies on
    its automatic measurement.
  - `expo-glass-effect` (iOS 26+ system glass) was NOT added: it is not
    in the required dep list and was not verified against SDK 58 here.
    Glass is `expo-blur` over a tinted surface (see glassyui README).
  - Placeholder 1×1 PNGs stand in for `assets/icon.png`,
    `assets/adaptive-icon.png`, `assets/favicon.png` — real artwork is
    still needed before any store/listing use.

### What was built

- `package.json` / `app.json` / `babel.config.js` / `tsconfig.json` —
  hand-written minimal Expo Router scaffold (SDK current stable via
  npm, not a template). Scripts: `typecheck`, `test` (vitest),
  `start`/`android`/`ios`/`web`. Hermes engine enabled via the
  standard Expo build (the Android export emits `.hbc` bytecode).
  Deep links via scheme `hermes`: `hermes://chat/{id}`,
  `hermes://group/{name}`, `hermes://tasks/{id}`,
  `hermes://settings/connection` map to the matching routes.
- `src/theme/tokens.ts` — dark-first tokens exactly from the design
  contract §3.1 (bg `#1c1c1e` dark / `#faf9f7` light, tile, text,
  secondary, accent `#0067d9`, invalid, jade, gold, rose, violet,
  gray); spacing 4/8/12/16/20/24/32/48; radii per contract; system
  fonts only; minimum font 11. Light jade is fill-only, never text
  (contrast-gated `GlassBadge` uses dark ink on tinted fills).
- `src/lib/gateway.ts` — one durable `/api/ws` NDJSON JSON-RPC client:
  15 s open + 15 s ready timeouts, `gateway.ready` payload pinned
  (first wins), replies routed by id (30 s RPC, 120 s `file.attach`,
  10 min turn wait), pushed events by `session_id`/`sid`, terminal set
  `message.complete`/`turn.end`/`turn.error`/`turn.failed`/`error`,
  server→client requests answered (clarify → `{}` if unparseable,
  unknown → `-32601`), held-elsewhere detection
  (`/open in another Hermes (window|terminal)/i` → read-only), never
  auto-resubmit, exponential-backoff reconnect, REST helpers for
  status / profiles-sessions / session messages / model options /
  cron (list/detail/runs/trigger/create/blueprints/delivery-targets/
  prompt update) / audio transcribe. `getAuthToken` plumbing sends
  the SecureStore device credential as a Bearer header on REST calls
  once a token exists (see the coordinator flag below).
- `src/lib/auth.ts` + `src/lib/connection-store.ts` — multi-host list
  (name + URL), device credentials ONLY in SecureStore, loopback
  (`127.0.0.1`/`localhost`/`::1`) rejected with a plain-language
  error, remote gateway with `auth_required !== true` refused with
  the spec's exact message, per-connection WS tickets minted per
  connection (never cached long-lived), disconnect deletes the
  credential, closes the socket and clears pending journal intents
  for that host.
- `src/lib/turn-journal.ts` — intent persisted BEFORE `prompt.submit`
  in AsyncStorage (NOT the credential store); write failure aborts
  the send (zero prompts); resend is an explicit user action only,
  never automatic.
- `src/lib/roster.ts` (+ `group-create.ts`, `use-roster.ts`) — roster
  from `profiles.list` `include_sessions:true` only, canonical id
  `resolved_id || id`, groups from `ui_meta['hermes-bots'].groups`
  (whole-object writes), recency sort by `last_active`,
  `sessions.changed` treated as a refetch signal only.
- Routes (one file per route): `(tabs)/bots|Sessions|Tasks`,
  `chat/[sessionId]`, `chat/new`, `group/[groupName]`, `group/new`,
  `bot/[profile]/settings|capabilities|routines|computer`, `bot/new`,
  `tasks/new`, `tasks/[jobId]`, `settings/index|connection|
  notifications|appearance|about`, `(modals)/clarify|approval`.
  Tabs are Bots | Sessions | Tasks only; Settings is a header
  action. Back-stack: sheet > screen > tab reset to Bots.
- `src/components/glassyui/*` — Tier-1 set reimplemented for this
  repo (GlassSurface/GlassBackdrop with the Android backdrop note,
  GlassButton prominent/primary/soft/ghost, GlassInput, GlassTextarea,
  GlassTabs, GlassSegmentedControl, GlassAvatar+Group, GlassBadge
  (contrast-gated), GlassSheet, GlassDialog, GlassToast, GlassSkeleton,
  GlassSpinner, GlassAlert, GlassMenu, GlassSwitch, GlassProgress)
  with README (inspired by alexburlis/glassyui, MIT, NOT copied
  registry code) + THIRD_PARTY_NOTICES.md.
- Hermes components: ChatThread (FlashList, isolated streaming bubble,
  frame-coalesced deltas), MessageBubble (20r/6r tail), Composer
  (glass bar, attach chips order/retry/remove, slash completion via
  `complete.slash`, voice tap = review-card-first / ~2.5 s hold =
  send, per-chat model override label), Row (one shared component
  for Bot/Session/Task rows), ConnectionBanner, EmptyState,
  CapabilityRow, ClarifyCard, ApprovalCard.
- Screens implement: chat (follow-only-near-bottom + Latest pill,
  tool/reasoning collapsed activity rows showing the host summary
  only — never raw CoT — usage on tap, edit-and-resend, Stop via
  `session.interrupt`, silence watchdog refetching the transcript,
  read-only banner when held elsewhere), group chat (driver gate,
  membership-first creation, string `event_id`, seq-ordered log),
  tasks (Running/Scheduled/Paused-attention, blueprint + custom
  create, prompt editor, pause/resume/trigger/delete with confirm
  dialog, optimistic rollback), capabilities (at-least-one-toolset
  rule, swallowed `ok:false`/`applied:false` treated as failure, hub
  install requires `installed === true`), bot settings (SOUL editor,
  authenticated-providers-only model picker, default vs
  session-override labelling), connection (probe 10 s, Tailscale
  checklist, saved hosts), notifications (quiet hours default
  22:00–07:00 suppress alerts only, per-bot include empty = all),
  appearance (System/Dark/Light, reduce motion/transparency honoured),
  about (upstream attribution + independent-community disclaimer).
- Cleartext: `app.json` sets no `usesCleartextTraffic` and no cleartext
  allowance anywhere in the app — this removes the upstream APK's
  explicit `usesCleartextTraffic=true`. Note: `http://` URLs on a
  Tailscale tailnet are still accepted by the probe (WireGuard-
  encrypted tailnet, not a public cleartext allowance); tighten
  `validateGatewayUrl` to https-only if a stricter policy is wanted.
- Tests (`__tests__/`): gateway envelope/terminal events,
  chat-reconcile idempotency, attachment routing order, cron-state
  sections, connection-state (loopback rejection,
  unauthenticated-remote refusal), group room-id/name handling,
  turn-journal (write-failure sends zero, no auto-resend).

### STUB / UNVERIFIED (never present as confirmed)

- `turn.recover` / `turn.status` and the exact approval-request method
  name: NOT confirmed against a live host's `gateway.ready` (port-spec
  §13 open question 2). The app reconciles from the host transcript
  instead, and the approval modal renders the card but does not yet
  resolve a live pending server request — wiring to the pending
  request is marked in `app/(modals)/approval.tsx`.
- Display viewer v1: thumbnail stream + read-only fallback ONLY. No
  native VNC component was verified at build time, so no control
  affordance is shown that the transport cannot honour (the screen
  says so explicitly). Lease release is wired; take-control is
  deliberately absent until a verified control path exists. (This
  matches the gateway's RFB-bridge stub status: ticket + lease gate
  real, frame forwarding TODO(RFB) — the two stubs line up.)
- Voice: the composer implements tap = review-card-first and ~2.5 s
  hold = send, but on-device STT and the host-transcription upload
  path are not wired to a real recorder yet — the tap currently
  inserts a clearly-labelled placeholder draft, and attachment picking
  needs a file-picker grant. Both are labelled in code, not hidden.
- Native PKCE sign-in: the connection screen probes, enforces the
  refusal rule, and requires an advertised `native_pkce` flow, but the
  actual PKCE exchange against a live host is not implemented — the
  pairing step stores a placeholder credential in SecureStore. Do not
  ship pairing until the real exchange is built and tested against a
  live host.
- Notifications: `expo-notifications` is configured (plugin + dep) but
  push delivery via the gateway proxy (port-spec §9.4) does not exist
  yet on the app side; background completion alerts are therefore not
  live.
- Per-chat model override via `config.set --session` and the
  regenerate action: implemented as specified but host-unverified
  (regenerate is edit-and-resend only; no separate host regenerate
  method is assumed).
- Wide-layout three-pane (tablet/foldable) is NOT implemented — phones
  keep the single-surface flow; the wide shell is future work.
- Host version in About is not yet wired to the live `/api/status`
  result (the connection screen shows it; About shows the app
  version only).

### Coordinator flags (need a decision, not code changes by this agent)

1. Probe-vs-proxy auth ordering: the gateway section says `/api/status`
   requires the device credential (only `/healthz` is unauthenticated)
   and "the phone's probe therefore sends URL + device token together".
   Before pairing there is no device token, so the app's probe goes
   out unauthenticated (correct for a direct host, 401 against the
   proxy). This agent added `getAuthToken` plumbing so every REST call
   after pairing carries the Bearer token, but the first-pairing
   probe-against-proxy flow is still undefined: either the proxy
   must allow an unauthenticated probe, or pairing must mint the
   device token out-of-band first. Do not paper over this — decide
   the flow before release.
2. The chat screen consumes pushed events through an in-process event
   bus (`chatEventBus` in `app/chat/[sessionId].tsx`, fed by the
   gateway client's `onEvent` set at connect time in the connection
   screen). This preserves one socket per host, but a cleaner home
   for the bus is `src/lib/` — left as-is to avoid churn; the
   coordinator may move it.
3. `app/` is not a git repository on this machine (no `.git` found),
   so nothing was committed or pushed here, per the task. The
   coordinator owns merge + push. `node_modules/` is present locally
   (real install for the lockfile) and is git-ignored.
