# Hermes gateway proxy

A single-binary Rust (Axum) proxy that sits **next to the Hermes host**
and gives the Expo phone app a safe, authenticated way to reach it.
Clean-room implementation from `analysis/port-spec.md` §5–§6 and §9–§10;
no upstream Tauri Rust source is copied here.

The proxy **forwards**. It does not re-implement Hermes, embed a model,
execute tools, run a shell, or store LLM provider credentials. If it
cannot forward a request, it rejects it with a plain error — it never
synthesises a Hermes response.

## Build

```sh
cargo build --release
# binary: target/release/hermes-gateway
```

Requires a Rust toolchain (cargo). CI runs fmt, clippy, tests, and a
release build on every push; the same commands run locally before push.

## Run (next to Hermes)

```sh
HERMES_ORIGIN=http://127.0.0.1:9119 \
HERMES_DEVICE_TOKEN='<long-random-device-token>' \
HERMES_HOST_BEARER='<host-credential-if-required>' \
LISTEN_ADDR=100.x.y.z:9120 \
./target/release/hermes-gateway
```

- `HERMES_ORIGIN` is the Hermes host as seen **from the proxy machine**.
  Loopback (`http://127.0.0.1:9119`) is correct here, on the host side
  only. The phone never talks to `127.0.0.1` — it talks to this proxy
  over the tailnet/LAN.
- `LISTEN_ADDR` must be the machine's Tailscale or LAN address
  (e.g. its `100.x` Tailscale IP). The default is `127.0.0.1:9120`
  (loopback-only, safe but phone-unreachable) precisely so a careless
  start does not expose anything.
- Run it as a system service on the host (systemd unit, `Restart=always`)
  so it survives reboots next to Hermes. No runtime beyond the binary.

## Config reference

Env wins over the optional JSON config file (`HERMES_CONFIG_FILE`;
see `config.example.json`). `RUST_LOG` controls log verbosity
(default `hermes_gateway=info`).

| Variable | Default | Meaning |
|---|---|---|
| `HERMES_ORIGIN` | *(required)* | Hermes host origin, e.g. `http://127.0.0.1:9119` |
| `LISTEN_ADDR` | `127.0.0.1:9120` | Socket address to bind |
| `HERMES_DEVICE_TOKEN` | *(required unless `HERMES_TRUST_PROXY_AUTH=1`)* | Bootstrap device credential. Accepted only while zero devices are paired; once the first device pairs, per-device tokens replace it (see Pairing) |
| `GBOTS_STORE_PATH` | `gbots-store.db` | SQLite device-store path (pair codes, devices, server keys). Keep this file on the host, mode `0600` |
| `HERMES_TRUST_PROXY_AUTH` | `0` | `1` only when an authenticated reverse proxy in front already verifies the device |
| `HERMES_HOST_BEARER` | — | Host credential attached server-side to Hermes (REST + WS). Never sent to the phone |
| `HERMES_HOST_COOKIE` | — | Host session cookie attached server-side, if the host uses cookie auth |
| `HERMES_ALLOW_PUBLIC_BIND` | `0` | `1` required to bind `0.0.0.0`/`[::]` — and even then only behind an authenticated reverse proxy |
| `HERMES_MAX_UPLOAD_MB` | `25` | Attachment/transcription intake cap; oversize → `413` |
| `HERMES_MAX_BODY_MB` | `32` | Generic REST body cap; oversize → `413` |
| `HERMES_RATE_PER_MIN` | `600` | Token-bucket refill per device credential, per minute |
| `HERMES_RATE_BURST` | `120` | Token-bucket burst |
| `HERMES_WS_CHANNEL_CAPACITY` | `128` | Bound for every WS mpsc channel (see Backpressure) |
| `HERMES_TICKET_TTL_SECS` | `30` | Single-use ticket lifetime |
| `HERMES_PUSH_TOKENS` | — | **Env only.** Comma-separated Expo push tokens; empty = push disabled (one log line, not an error loop) |
| `HERMES_PUSH_QUIET_START` / `HERMES_PUSH_QUIET_END` | `22` / `7` | Quiet hours (local time, wrap-around supported); suppresses alerts, never progress state |
| `HERMES_PUSH_INCLUDE_PROFILES` | — | **Env only.** Comma-separated profile names; empty = all Bots |

## Endpoints

| Route | Auth | Behaviour |
|---|---|---|
| `GET /healthz` | none | Proxy's own health: `{status, service, version}` |
| `GET /api/gbots` | none | Pairing discovery: `{app: "gbots", version, server_id, fingerprint, identity, sealing}`. The phone checks the fingerprint against the QR before pairing |
| `POST /api/pair` | none, attempt-limited per peer IP | Redeem a one-time pair code (sealed request) and return `{device_id, token}`. Wrong/expired/used codes all return the same `401` |
| `GET /api/status` | device | Host `/api/status` passthrough + a `proxy` info object (`version`, `ws`, `push_enabled`, `turn_recovery: conditional-on-gateway-ready`). Mobile probe target. Host unreachable → `502` plain error |
| `GET /api/profiles/sessions` | device | REST passthrough |
| `GET /api/sessions/{…}` | device | REST passthrough (incl. `/messages` transcript) |
| `GET /api/model/{…}` | device | REST passthrough (model options) |
| `POST /api/audio/{…}` | device | REST passthrough with the upload cap (transcription) |
| `ANY /api/cron/{…}` | device | REST passthrough: jobs, runs, trigger, create, blueprints, `blueprints/instantiate`, delivery-targets, prompt update |
| `ANY /auth/{…}`, `ANY /api/auth/{…}` | device | Host auth passthrough: password login, PKCE exchange, token refresh. Host session cookie forwarded and `Set-Cookie` returned verbatim; the proxy stores no provider keys |
| `POST /api/auth/ws-ticket` | device | Mint a short-lived (30 s), single-use ticket for the proxy's own `/api/ws`. The proxy attaches the host credential server-side when dialling upstream, so the phone never needs a host ticket |
| `POST /api/auth/revoke` | device | Revoke the calling device: delete it from the store and purge its tickets. In bootstrap/trust-proxy mode, clears tickets only |
| `GET /api/ws` | device bearer **or** single-use `?ticket=` | NDJSON JSON-RPC proxy (below) |
| `POST /api/display/ticket` | device | Mint a single-use display ticket + `viewer_id` for `/api/display/ws` |
| `GET /api/display/ws?ticket=…` | display ticket | RFB bridge **STUB** (below) |
| `POST /api/attachments` | device | Multipart attachment intake → host `file.attach` (below) |

All forwarding preserves method, path, query, and body, returns the
host's status/body/errors verbatim, and strips the phone's device
credential before contacting the host.

## Pairing

Phones pair by QR, not by pasting a token. The gateway must already be
running; the `pair` command only mints the code in the store:

```sh
hermes-gateway pair --public-url http://100.x.y.z:9120
```

This prints an ASCII QR plus the link and the code grouped 4-4. The
code works once and expires after 10 minutes. The phone scans the QR,
checks the fingerprint against `GET /api/gbots`, then posts a sealed
pair request to `POST /api/pair` and stores the returned per-device
credential. Full design: `gbots-pairing-design.md` (maintainer
analysis notes, kept alongside the repo workspace, not shipped in
this repo).

```sh
hermes-gateway devices          # list paired devices
hermes-gateway unpair <id>      # revoke one device (tokens + tickets die)
```

Notes:

- The QR URL must be reachable from the phone (Tailscale/LAN
  address). If `LISTEN_ADDR` is still loopback, `pair` warns: restart
  the gateway with `LISTEN_ADDR=<tailnet-ip>:9120` first.
- Never share a screenshot of the QR: anyone holding it can pair a
  phone until the code expires or is used.
- The server keys in the store (`gbots-store.db`) are the pairing
  identity. If the file is lost, every device must re-pair; back it
  up with the rest of the host's secrets.
- `HERMES_DEVICE_TOKEN` is bootstrap-only: it authenticates while
  zero devices are paired, and stops working once the first device
  pairs. Headless/CI setups that relied on the env token should pair
  one device and switch to its token.

## WebSocket proxy (`/api/ws`)

One durable upstream connection per mobile connection. Lines are
forwarded verbatim in both directions through a single writer task per
direction, so ordered `seq` passthrough is preserved and nothing is
reordered or rewritten. Every line is parsed only to extract
`session_id`/`sid` for per-session routing and the live-session
registry; message content is never logged or stored.

**Backpressure:** each direction runs through a bounded tokio mpsc
channel (default capacity 128). When the channel is full, the reader
awaits, which pauses socket reads — a slow phone consumer pauses
upstream reads. There is no unbounded buffering and no silent drop of
NDJSON text lines (binary frames are not NDJSON and are logged +
dropped).

**Reconnect:** the upstream dial retries with backoff
(0.5 s → 30 s, then the mobile socket is closed with 1011) so the
client re-resumes cleanly. The proxy never replays or re-submits a
turn. **Turn re-attach is conditional:** if the host's `gateway.ready`
payload advertises `turn.recover`/`turn.status`, the client may use it;
otherwise the client reconciles from the transcript endpoint
(`GET /api/sessions/{id}/messages`). The proxy logs what
`gateway.ready` advertised and never calls an unadvertised host method.

## Push (Expo Push Service)

Live code, metadata-only. The proxy holds a durable host subscription;
when a terminal event (`message.complete` / `turn.end`) arrives for a
session with no live mobile socket, and the Bot passes quiet-hours and
per-Bot gates, the proxy posts one ticket per configured token to
Expo Push Service containing only the Bot name, a generic body
("Finished", "Needs your approval"), and `data: {kind, id}`. No message
content the user did not opt into, no secrets, no tokens. `sessions.changed`
is a bare refetch signal and never produces a push. If
`HERMES_PUSH_TOKENS` is empty, push is disabled with one log line.

## RFB bridge (`/api/display/ws`) — STUB in v1

Ticket minting (`POST /api/display/ticket`) and the single-holder lease
gate are real: a connection whose `viewer_id` is not the current holder
is refused (1008, log line), and a frame naming another viewer is
dropped with a log line. Frame forwarding itself is NOT implemented:
holder frames are logged (kind only) and dropped. No RFB bytes are
fabricated. The host lease (`display.lease.acquire` via WS RPC) remains
authoritative — the host's RFB filter also drops non-holder input.
`TODO(RFB)` in `src/ws.rs` marks where the host RFB dial goes.

## Uploads (`POST /api/attachments`)

Multipart `file` (+ `session_id`, optional `name`). The field is
streamed in chunks and rejected with `413` past the cap, held in one
bounded buffer, base64-encoded exactly once into a data URL, and handed
to the host's `file.attach` WS RPC over a short-lived upstream
connection (120 s timeout, per spec). The host reply is returned
verbatim; the app checks `attached === true` and a `ref_text`.

## Rate / abuse guardrails

Per-device token bucket on REST (keyed by hashed credential, never the
raw token; `429` + `Retry-After` on exhaustion) and a per-connection
bucket on the WS pump (exhaustion closes the connection so the client
reconnects with backoff rather than silently losing lines). Request-size
caps per the config table. Structured logs carry method, path, status,
and latency only — never tokens, headers, bodies, or message content.

## Security posture

- **Tailscale-first.** Phone and proxy join the same tailnet (or an
  authenticated HTTPS tunnel). Never open port 9119 — or this proxy's
  port — to the public internet.
- **Cleartext OFF by default for the phone path.** The phone app never
  uses cleartext to reach the proxy; the proxy-to-host hop is loopback
  on the same host (or the same tailnet) and is documented separately
  from the phone hop. `HERMES_ORIGIN` may be `http://` only because it
  is loopback on the host machine.
- **No `0.0.0.0` on a public host** without an authenticated reverse
  proxy in front (`HERMES_ALLOW_PUBLIC_BIND=1` is an explicit,
  deliberate opt-in, and still assumes the proxy in front).
- **Device credential on every request** (except `/healthz`,
  `/api/gbots`, `/api/pair`, and the two WS routes which authenticate
  in-handler: bearer-or-ticket / ticket). Per-device tokens from QR
  pairing; revoke one device via `hermes-gateway unpair <id>` or
  `POST /api/auth/revoke` from the device itself.
- **Provider credentials never pass through** in a form the app can
  read. `profiles.create`'s `mirror_credentials`/`share_auth` are
  host-side flags; the proxy never sees provider keys.

## Stub vs live

| Area | Status |
|---|---|
| REST passthrough (status, sessions, model, audio, cron, auth) | **Live** (forwarding; needs a real Hermes host to verify end-to-end) |
| WS proxy (`/api/ws`) | **Live** (fan-in/fan-out, backpressure, backoff dial, ticket/bearer auth) |
| Ticket minting + revocation | **Live** (tickets in-memory, device-bound; revocation per-device, persistent) |
| QR pairing (`/api/gbots`, `/api/pair`, CLI below) | **Live** (needs a real phone + host to verify end-to-end) |
| Push watcher + Expo tickets | **Live** code, **disabled** unless `HERMES_PUSH_TOKENS` is set; metadata-only |
| Attachment intake → `file.attach` | **Live** code (single bounded buffer, one base64 pass, 120 s upstream RPC) |
| RFB bridge | **STUB** — ticket + lease gate real, frame forwarding TODO(RFB) |
| Turn re-attach | **Conditional** — only if `gateway.ready` advertises `turn.recover`/`turn.status`; otherwise transcript reconcile (client-side) |

## Verification

CI runs the compile gate on every push (from `app/gateway/`):

```sh
cargo fmt --check
cargo clippy -- -D warnings
cargo test
cargo build --release
```

The same commands are verified locally before push (cargo 1.99.1 on
the dev machine). The axum 0.8 / tungstenite surface choices in this
code (Utf8Bytes deref in `ws.rs`, upstream dial via
`http::Request<()>` into `connect_async`, `to_bytes` + `{*rest}`
wildcard routes, default-features tungstenite = `ws://` upstream
only) are all compiled and passing in CI; `wss://` upstream support
still needs a TLS feature (e.g. `rustls-tls-native-roots`) added and
verified before anyone points `HERMES_ORIGIN` at https.

No live-host verification was claimed: there is no live Hermes host
available from this machine, so end-to-end behaviour (real host
replies, real ticket flows, real push delivery) must be verified
against a host before release.
