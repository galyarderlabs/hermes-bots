//! QR pairing: public discovery + pair endpoints, QR printing, CLI.
//!
//! The pair flow (see analysis/gbots-pairing-design.md):
//! server prints a QR -> phone scans -> fingerprint check against
//! /api/gbots -> sealed pair request -> /api/pair redeems the code and
//! returns a per-device credential. The sealed request is a libsodium
//! sealed box (X25519, HSalsa20-derived key, XSalsa20-Poly1305,
//! nonce = BLAKE2b-24 of ephemeral_pk || recipient_pk), so the phone side (tweetnacl) and
//! this side must agree byte-for-byte; the vector test in this module
//! pins the construction against a libsodium-generated vector.

use std::net::SocketAddr;

use axum::extract::{ConnectInfo, Json, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::state::AppState;
use crate::store::{hash_bytes, store_path_from_env, PairStore};

/// Base64url without padding, the wire encoding for keys and tokens.
pub fn b64u(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Accepts padded or unpadded base64url.
pub fn decode_b64u(value: &str) -> Result<Vec<u8>, String> {
    let stripped = value.trim_end_matches('=');
    let mut padded = stripped.to_string();
    while !padded.len().is_multiple_of(4) {
        padded.push('=');
    }
    base64::engine::general_purpose::URL_SAFE
        .decode(padded)
        .map_err(|e| format!("invalid base64url: {e}"))
}

/// Fresh per-device credential: 32 random bytes, base64url.
pub fn new_device_token() -> String {
    let bytes: [u8; 32] = rand::random();
    b64u(&bytes)
}

/// Decrypt a libsodium sealed box with the server sealing key.
/// Wire format: ephemeral_pk (32B) || XSalsa20-Poly1305 box.
pub fn sealed_box_open(sealing_sk: &[u8; 32], sealed: &[u8]) -> Result<Vec<u8>, String> {
    if sealed.len() < 48 {
        return Err("sealed payload too short".to_string());
    }
    let ephemeral_pk: [u8; 32] = sealed[..32]
        .try_into()
        .map_err(|_| "sealed payload malformed".to_string())?;
    let ciphertext = &sealed[32..];
    // The recipient public key feeds the nonce; the shared box key is
    // derived by SalsaBox (X25519 + HSalsa20), exactly like libsodium
    // crypto_box_seal — the raw DH output is NOT the box key.
    let recipient_pk = crypto_box::PublicKey::from(
        x25519_dalek::PublicKey::from(&x25519_dalek::StaticSecret::from(*sealing_sk)).to_bytes(),
    );
    let mut nonce_bytes = [0u8; 24];
    {
        use blake2::digest::{Update, VariableOutput};
        let mut hasher =
            blake2::Blake2bVar::new(24).map_err(|e| format!("blake2 init failed: {e}"))?;
        hasher.update(&ephemeral_pk);
        hasher.update(recipient_pk.as_bytes());
        hasher
            .finalize_variable(&mut nonce_bytes)
            .map_err(|e| format!("blake2 finalize failed: {e}"))?;
    }
    use aead::Aead;
    let bx = crypto_box::SalsaBox::new(
        &crypto_box::PublicKey::from(ephemeral_pk),
        &crypto_box::SecretKey::from(*sealing_sk),
    );
    let nonce = crypto_box::Nonce::from_slice(&nonce_bytes);
    bx.decrypt(nonce, ciphertext)
        .map_err(|_| "sealed box open failed".to_string())
}

/// Pair link carried by the QR: the full fingerprint rides along so the
/// phone can compare it against /api/gbots before sending anything.
pub fn pair_link(public_url: &str, code: &str, fingerprint: &str) -> String {
    format!(
        "{}/#pair={}&fp={}",
        public_url.trim_end_matches('/'),
        code,
        fingerprint
    )
}

/// "ABCD2345" -> "ABCD-2345", for reading the code aloud / typing it.
pub fn group_code(code: &str) -> String {
    if code.len() == 8 {
        format!("{}-{}", &code[..4], &code[4..])
    } else {
        code.to_string()
    }
}

fn print_qr(text: &str) -> Result<(), String> {
    let code =
        qrcode::QrCode::new(text.as_bytes()).map_err(|e| format!("cannot encode QR: {e}"))?;
    let rendered = code
        .render::<qrcode::render::unicode::Dense1x2>()
        .quiet_zone(true)
        .build();
    println!("{rendered}");
    Ok(())
}

#[derive(Serialize)]
struct GbotInfo {
    app: &'static str,
    version: &'static str,
    server_id: String,
    fingerprint: String,
    identity: String,
    sealing: String,
}

#[derive(Serialize)]
struct ErrorBody {
    error: &'static str,
}

fn error_response(status: StatusCode, error: &'static str) -> Response {
    (status, Json(ErrorBody { error })).into_response()
}

/// GET /api/gbots — public discovery. No host data, only the identity
/// the phone needs to check the QR fingerprint against.
pub async fn gbots_info_handler(State(state): State<AppState>) -> Response {
    let keys = match state.pair_store.server_keys() {
        Ok(k) => k,
        Err(e) => {
            tracing::warn!("gbots info failed: {e}");
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "store unavailable");
        }
    };
    let fingerprint = hash_bytes(&keys.identity_pk);
    let server_id = fingerprint[..16].to_string();
    (
        StatusCode::OK,
        Json(GbotInfo {
            app: "gbots",
            version: env!("CARGO_PKG_VERSION"),
            server_id,
            fingerprint,
            identity: b64u(&keys.identity_pk),
            sealing: b64u(&keys.sealing_pk),
        }),
    )
        .into_response()
}

#[derive(Deserialize)]
pub(crate) struct PairRequest {
    sealed: String,
}

#[derive(Deserialize)]
struct PairPayload {
    code: String,
    name: String,
    platform: String,
    sign_key: String,
}

#[derive(Serialize)]
struct PairResponse {
    device_id: String,
    token: String,
}

/// POST /api/pair — public, attempt-limited per peer IP. A wrong code,
/// expired code, or used code all return the same 401: no oracle for
/// guessers. Malformed requests return 400 without consuming a code.
pub async fn pair_handler(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<PairRequest>,
) -> Response {
    if !state.rate.check(&format!("pair:{}", addr.ip())) {
        return error_response(StatusCode::TOO_MANY_REQUESTS, "too many attempts");
    }
    let sealed = match decode_b64u(&body.sealed) {
        Ok(v) => v,
        Err(_) => return error_response(StatusCode::BAD_REQUEST, "invalid request"),
    };
    let keys = match state.pair_store.server_keys() {
        Ok(k) => k,
        Err(e) => {
            tracing::warn!("pair failed: {e}");
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "store unavailable");
        }
    };
    let plaintext = match sealed_box_open(&keys.sealing_sk, &sealed) {
        Ok(v) => v,
        Err(_) => return error_response(StatusCode::UNAUTHORIZED, "invalid or expired code"),
    };
    let payload: PairPayload = match serde_json::from_slice(&plaintext) {
        Ok(v) => v,
        Err(_) => return error_response(StatusCode::BAD_REQUEST, "invalid request"),
    };
    if payload.name.trim().is_empty() || payload.name.len() > 64 || payload.platform.len() > 32 {
        return error_response(StatusCode::BAD_REQUEST, "invalid request");
    }
    let sign_key_bytes = match decode_b64u(&payload.sign_key) {
        Ok(v) if v.len() == 32 => v,
        _ => return error_response(StatusCode::BAD_REQUEST, "invalid request"),
    };
    let mut sign_key_arr = [0u8; 32];
    sign_key_arr.copy_from_slice(&sign_key_bytes);
    if ed25519_dalek::VerifyingKey::from_bytes(&sign_key_arr).is_err() {
        return error_response(StatusCode::BAD_REQUEST, "invalid request");
    }
    let role = match state.pair_store.redeem_pair_code(&payload.code) {
        Ok(Some(role)) => role,
        Ok(None) => return error_response(StatusCode::UNAUTHORIZED, "invalid or expired code"),
        Err(e) => {
            tracing::warn!("pair failed: {e}");
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "store unavailable");
        }
    };
    let token = new_device_token();
    let device_id = match state.pair_store.add_device(
        payload.name.trim(),
        &payload.platform,
        &token,
        &payload.sign_key,
        &role,
    ) {
        Ok(id) => id,
        Err(e) => {
            tracing::warn!("pair failed: {e}");
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "store unavailable");
        }
    };
    tracing::info!("device paired: {} ({})", payload.name.trim(), device_id);
    (StatusCode::OK, Json(PairResponse { device_id, token })).into_response()
}

fn print_pair_usage() {
    eprintln!("usage: hermes-gateway pair [--public-url http://<tailnet-ip>:9120]");
    eprintln!("       GBOTS_PUBLIC_URL env is used when --public-url is absent.");
}

fn open_cli_store() -> Result<PairStore, i32> {
    PairStore::open(&store_path_from_env()).map_err(|e| {
        eprintln!("hermes-gateway: {e}");
        1
    })
}

fn fmt_ts(ts: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp(ts, 0)
        .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|| "-".to_string())
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        text.chars().take(max).collect()
    }
}

/// `hermes-gateway pair [--public-url URL]` — mint a one-time code and
/// print its QR. The gateway server must be running for the phone to
/// reach the URL; this command only writes the code to the store.
/// Exits 0 on success, 1 on store failure, 2 on bad arguments.
pub fn cli_pair(args: &[String]) -> i32 {
    let mut public_url: Option<String> = std::env::var("GBOTS_PUBLIC_URL")
        .ok()
        .filter(|v| !v.trim().is_empty());
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--public-url" => {
                i += 1;
                match args.get(i) {
                    Some(v) => public_url = Some(v.clone()),
                    None => {
                        eprintln!("hermes-gateway pair: --public-url needs a value");
                        print_pair_usage();
                        return 2;
                    }
                }
            }
            "--help" => {
                print_pair_usage();
                return 0;
            }
            other => {
                eprintln!("hermes-gateway pair: unknown argument {other}");
                print_pair_usage();
                return 2;
            }
        }
        i += 1;
    }
    let Some(url) = public_url else {
        eprintln!("hermes-gateway pair: no public URL.");
        eprintln!("Pass --public-url http://<tailnet-ip>:9120 (or set GBOTS_PUBLIC_URL).");
        eprintln!("The phone must reach this URL; a loopback address will not work.");
        print_pair_usage();
        return 2;
    };
    let store = match open_cli_store() {
        Ok(s) => s,
        Err(code) => return code,
    };
    let code = match store.create_pair_code() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("hermes-gateway pair: {e}");
            return 1;
        }
    };
    let fingerprint = match store.fingerprint_hex() {
        Ok(f) => f,
        Err(e) => {
            eprintln!("hermes-gateway pair: {e}");
            return 1;
        }
    };
    let link = pair_link(&url, &code, &fingerprint);
    if let Err(e) = print_qr(&link) {
        eprintln!("hermes-gateway pair: {e}");
        return 1;
    }
    println!();
    println!("Link: {link}");
    println!(
        "Code: {}   (expires in 10 minutes, works once)",
        group_code(&code)
    );
    println!("Never share a screenshot of this QR: anyone holding it can pair a phone.");
    let listen = std::env::var("LISTEN_ADDR").unwrap_or_else(|_| "127.0.0.1:9120".to_string());
    if let Ok(addr) = listen.parse::<SocketAddr>() {
        if addr.ip().is_loopback() {
            println!("Warning: LISTEN_ADDR is loopback ({listen}); restart the gateway with LISTEN_ADDR=<tailnet-ip>:9120 or the QR URL will not be reachable from the phone.");
        }
    }
    0
}

/// `hermes-gateway devices` — list paired devices.
pub fn cli_devices() -> i32 {
    let store = match open_cli_store() {
        Ok(s) => s,
        Err(code) => return code,
    };
    let devices = match store.list_devices() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("hermes-gateway devices: {e}");
            return 1;
        }
    };
    if devices.is_empty() {
        println!("No paired devices.");
        return 0;
    }
    println!(
        "{:<34} {:<20} {:<10} {:<8} {:<16} {:<16}",
        "ID", "NAME", "PLATFORM", "ROLE", "PAIRED", "LAST SEEN"
    );
    for d in devices {
        println!(
            "{:<34} {:<20} {:<10} {:<8} {:<16} {:<16}",
            d.id,
            truncate(&d.name, 20),
            d.platform,
            d.role,
            fmt_ts(d.created_at),
            fmt_ts(d.last_seen)
        );
    }
    0
}

/// `hermes-gateway unpair <id>` — revoke one device. Its tokens and
/// outstanding tickets stop working immediately.
pub fn cli_unpair(args: &[String]) -> i32 {
    let Some(id) = args.first() else {
        eprintln!("usage: hermes-gateway unpair <device-id>");
        return 2;
    };
    let store = match open_cli_store() {
        Ok(s) => s,
        Err(code) => return code,
    };
    match store.remove_device(id) {
        Ok(true) => {
            println!("Removed device {id}.");
            0
        }
        Ok(false) => {
            eprintln!("No device with id {id}.");
            1
        }
        Err(e) => {
            eprintln!("hermes-gateway unpair: {e}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Libsodium-generated vector (see analysis/gbots-pairing-design.md
    // §6): recipient secret 0x11*32, ephemeral secret 0x22*32,
    // plaintext "gbots-pair-vector", sealed with crypto_box_seal.
    const VECTOR_RECIPIENT_SK_B64U: &str = "ERERERERERERERERERERERERERERERERERERERERERE";
    const VECTOR_SEALED_B64U: &str =
        "D6poTtKIZ7l_Smot7l34zpdOdrcBjj8iocTPJnhXDyDEstseASUkiA_ZOsRNl680vbnRBGqw52w8m2VMZHE6vf8";
    const VECTOR_PLAINTEXT: &str = "gbots-pair-vector";

    fn vector_sk() -> [u8; 32] {
        let bytes = decode_b64u(VECTOR_RECIPIENT_SK_B64U).unwrap();
        bytes.try_into().unwrap()
    }

    #[test]
    fn sealed_box_opens_libsodium_vector() {
        let sealed = decode_b64u(VECTOR_SEALED_B64U).unwrap();
        let out = sealed_box_open(&vector_sk(), &sealed).unwrap();
        assert_eq!(out, VECTOR_PLAINTEXT.as_bytes());
    }

    #[test]
    fn sealed_box_rejects_tampered_and_short() {
        let mut sealed = decode_b64u(VECTOR_SEALED_B64U).unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 0x01;
        assert!(sealed_box_open(&vector_sk(), &sealed).is_err());
        assert!(sealed_box_open(&vector_sk(), &[0u8; 10]).is_err());
        let other_sk = [0x33u8; 32];
        let sealed = decode_b64u(VECTOR_SEALED_B64U).unwrap();
        assert!(sealed_box_open(&other_sk, &sealed).is_err());
    }

    #[test]
    fn pair_link_and_group_code() {
        assert_eq!(
            pair_link("http://100.1.2.3:9120/", "ABCD2345", "deadbeef"),
            "http://100.1.2.3:9120/#pair=ABCD2345&fp=deadbeef"
        );
        assert_eq!(group_code("ABCD2345"), "ABCD-2345");
        assert_eq!(group_code("SHORT"), "SHORT");
    }
}
