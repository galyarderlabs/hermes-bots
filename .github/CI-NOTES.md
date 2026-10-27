# CI notes — Hermes Mobile (Expo + Rust gateway)

Workflows live in `.github/workflows/`. All use `actions/checkout@v4`,
need no secrets, and run with `contents: read`. Concurrency cancels
in-progress runs for pull requests only — `main` and tag builds always
run to completion, so a cancelled tag build can never masquerade as a
release.

## Workflows

### `android-release.yml` — app checks + Android debug APK

Triggers: push to `main`, tags `v*`, pull requests to `main`.

- **app-check** (Node 22, npm cache):
  1. `npm ci` — fails honestly if `package.json` / `package-lock.json`
     are absent or out of sync.
  2. `npm run typecheck`.
  3. `npm test` with `CI=true`. This runs the app's own suite, which
     per port-spec §10 must cover: gateway envelope + terminal events,
     chat-reconcile, attachment-routing, cron-state, connection-state,
     group/room-id, turn-journal acceptance, and the fake-gateway test
     double. CI does not invent those suites — a missing suite is the
     app agent's gap, not a CI pass.
  4. **Manifest sanity**: `app.json` must exist, its scheme must be
     `hermes`, its Android package must be `com.hermesagent.mobile`,
     and a grep for `cleartext` across `app.json` and any committed
     `AndroidManifest.xml` template must find nothing (fail if found).
  5. **Bundle-size guard** (best-effort): if the app defines a
     `bundle-size` npm script it is authoritative. Otherwise CI runs
     `expo export --platform android` and fails only if the measured
     gzipped JS total exceeds the 1 MB budget (design-contract §8.1).
     If the expo CLI is absent or the export cannot run, the step
     WARNS and exits 0 — CI never goes red on tooling absence alone,
     while typecheck/tests/prebuild/APK still gate the build.
     Caveat: the export fallback sums all exported route bundles, a
     conservative proxy for first-screen JS; a breach prints per-file
     sizes so it is diagnosable, and an app-defined `bundle-size`
     script replaces the proxy with a first-screen measurement.
- **android-debug-apk** (needs `app-check`): JDK 17 + Android SDK
  (cmdline tools, platform-tools, `platforms;android-34`,
  `build-tools;34.0.0`), then Expo prebuild for Android, then
  `./android/gradlew :app:assembleDebug --no-daemon`.
  - Prebuild prefers the app's own `prebuild` npm script when one
    exists, else `npx expo prebuild --platform android --non-interactive`.
  - The APK is **universal** unless the app's Gradle config adds
    splits — this workflow deliberately does not hardcode an
    arm64-v8a-only split.
  - Upload (artifact `hermes-mobile-expo-debug-apk`,
    `android/app/build/outputs/apk/debug/*.apk`, 30-day retention)
    runs on push/tag only. On pull requests the APK is still built
    (proving Gradle works) but never uploaded — the check-only path.

### `gateway-check.yml` — Rust gateway compile gate

Triggers: push to `main`, pull requests to `main`.

Working directory `gateway/`, Rust stable toolchain: `cargo fmt
--check`, `cargo clippy -- -D warnings`, `cargo test`,
`cargo build --release`. This gate exists because cargo is not
installed on the dev machine — CI is the compile proof for the gateway.
If `gateway/` is absent, these steps fail honestly; there is no stub.

### `lint-gates.yml` — design-contract gates (single home, no duplication)

Triggers: push to `main`, pull requests to `main`. Plain deterministic
greps, no custom ESLint plugin (see the workflow comments for the exact
exclusions and limitations). All three gates FAIL the build:

- **Gate A — raw hex**: no `#[0-9a-fA-F]{3,8}` literal outside token
  files (any `tokens.ts` / `material.ts`, covering
  `src/theme/tokens.ts` and the vendored glassyui token files), test
  files asserting token values, or comment-only lines.
- **Gate B — GlassSurface without GlassBackdrop** (best-effort): fails
  only on the clear violation — a file importing `GlassSurface` with
  no `GlassBackdrop` import in the same file (vendored glassyui sources
  and tests excluded). This checks imports, not JSX nesting, and does
  not cover a surface that receives its backdrop from a parent.
  Follow-up: replace with an AST-based lint rule checking JSX
  ancestry once the app tree exists.
- **Gate C — light jade as text**: any `14a874` outside token/material
  files, test files, and comment-only lines fails, with the message that light jade must never be
  text (2.90:1 on light bg, design-contract §3.1).

## Debug vs release signing — the boundary

Everything here is **debug signing only**. The uploaded APK is a debug
build for testing on device/emulator. Release signing is a separate step
needing Galih's keystore and is NOT in v1: no keystore, key alias, or
signing secret is referenced anywhere in these workflows, and none may
be added without his explicit keystore decision.

## What CI cannot verify

- **Live Hermes host connection**: no CI job talks to a real Hermes
  host. Connection/pairing, WS streaming, and approval flows are proven
  by the fake-gateway test double in `npm test` and by on-device testing
  against a real host.
- **Device performance budgets**: cold start < 2.5 s, tap-to-chat
  < 300 ms, 60 fps scroll, and the other design-contract §8.1 budgets
  are measured on a mid-range Android device, not in CI. CI's bundle-size
  guard is a proxy for one budget only.
- **Real-device glass tiers**: low/mid/high blur tiers, the Android
  `GlassBackdrop` rendering behaviour, and reduced-transparency /
  reduced-motion appearances cannot be proven by greps or a debug APK
  artifact. They need device verification; Gate B only proves the
  import is present in the same file.
- **Accessibility beyond tests**: a11y checks (labels on icon-only
  controls, 44 pt targets, design-contract §7) live in the app's
  component tests under `npm test`. CI adds no separate a11y scanner
  in v1.

## Local validation status

No Android SDK is installed on the dev machine, so the Gradle step is
validated by CI itself, not locally. What was validated locally before
handoff: YAML syntax of all three workflows (parsed cleanly), and the
lint-gate grep patterns against fixture files (see the handoff report).
The first green run on `main` is the verification for prebuild +
assembleDebug; if it goes red, the failure is real and must be fixed in
the app/gateway code or config, not papered over in CI.
