# Set up GBots for me

GBots is the phone app for the bots on your hosts — Hermes first, with
OpenWebUI and more hosts to come. This prompt sets up the Hermes path:
a Rust gateway on the host, plus the Android preview app on the phone.

## What you need

- A host PC already running Hermes Agent by Nous Research
  (https://hermes-agent.nousresearch.com/) — the host holds the bots,
  sessions, tools, approvals, and credentials. GBots never holds them.
- A Rust toolchain on the host (`cargo`).
- Phone and host on the same private network. Tailscale is the
  recommended way — the phone must never use `127.0.0.1` as the gateway
  address, because on the phone that points back at the phone itself.

## Steps

1. Clone the repo and build the gateway on the host:

   ```sh
   git clone https://github.com/galyarderlabs/hermes-bots.git
   cd hermes-bots/gateway
   cargo build --release
   ```

2. Run the gateway. By default it listens on `127.0.0.1:9120` on the
   host only. For pairing, restart it on the tailnet address instead
   (`LISTEN_ADDR=<tailnet-ip>:9120`), so the phone can reach it. Do
   not bind it publicly unless you know what you are doing — public
   binding requires `HERMES_ALLOW_PUBLIC_BIND=1` and is refused
   otherwise.

3. Install the Android preview from the latest release:

   https://github.com/galyarderlabs/hermes-bots/releases

   Uninstall any older preview first, and download on Wi-Fi — the
   preview build is a large universal debug build.

4. Pair the phone with the host. On the host, run:

   ```sh
   ./target/release/hermes-gateway pair --public-url http://<tailnet-ip>:9120
   ```

   It prints a QR code plus a one-time code (works once, expires
   after 10 minutes). On the phone, open Settings → Connection →
   Scan QR code and scan it. If the phone cannot scan (same-device
   case), use Enter code manually with the URL and the code from the
   terminal. Never share a screenshot of the QR.

5. After pairing, the app connects and waits for `gateway.ready`.
   Report the `gateway.ready` payload instead of claiming the
   connection works.

## What is verified, and what is not

- Verified: the preview app launches to the onboarding splash when
  unpaired and straight to the Bots tab when already paired, the landing
  page at https://galyarderlabs.github.io/hermes-bots/ is live, and
  the gateway passes its checks.
- Not yet verified: a live connection to a real Hermes host, and the
  unwired pieces — voice, file picking, push, tablet layout, and
  display take-control (the display viewer is read-only in the
  preview; take-control via the host lease is still being wired).

## Rules

- Never put provider credentials in the app. The host owns them.
- Never claim the setup works without the `gateway.ready` payload
  as evidence.
- Never invent a token, address, or payload. If a step fails, report
  exactly what failed and stop there.
