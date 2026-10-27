//! Configuration for the Hermes gateway proxy.
//!
//! Sources, in precedence order (highest first):
//!   1. Environment variables.
//!   2. An optional JSON config file (`HERMES_CONFIG_FILE`).
//!   3. Built-in defaults.
//!
//! Security rules enforced here:
//! - `HERMES_ORIGIN` (the Hermes host) is required. The proxy runs NEXT TO
//!   the host, so a loopback origin is correct on the host side only. The
//!   phone never talks to 127.0.0.1.
//! - Push settings come from the environment ONLY, never from the config
//!   file (push keys in the file are ignored with a warning).
//! - Binding `0.0.0.0` / `[::]` is refused unless `HERMES_ALLOW_PUBLIC_BIND=1`
//!   is set explicitly, and even then only behind an authenticated reverse
//!   proxy. The default listen address is loopback-only.

use std::env;
use std::net::SocketAddr;

use serde::Deserialize;

/// Optional JSON config file. Every field is optional; env wins.
#[derive(Debug, Default, Deserialize)]
pub struct FileConfig {
    pub hermes_origin: Option<String>,
    pub listen_addr: Option<String>,
    pub device_token: Option<String>,
    pub trust_proxy_auth: Option<bool>,
    pub host_bearer: Option<String>,
    pub host_cookie: Option<String>,
    pub max_upload_mb: Option<usize>,
    pub max_body_mb: Option<usize>,
    pub rate_per_min: Option<u32>,
    pub rate_burst: Option<u32>,
    pub ws_channel_capacity: Option<usize>,
    pub ticket_ttl_secs: Option<u64>,
    pub allow_public_bind: Option<bool>,
    /// Deliberately NOT honoured: push settings are env-only (see push.rs).
    #[serde(rename = "push")]
    pub push_ignored: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct Config {
    /// Hermes host origin, e.g. `http://127.0.0.1:9119`. No trailing slash.
    pub hermes_origin: String,
    pub listen_addr: SocketAddr,
    /// Device credential the phone presents. Required unless the proxy sits
    /// behind an authenticated reverse proxy (`trust_proxy_auth`).
    pub device_token: Option<String>,
    pub trust_proxy_auth: bool,
    /// Host credential attached server-side when talking to Hermes.
    /// NEVER sent to, or readable by, the phone.
    pub host_bearer: Option<String>,
    pub host_cookie: Option<String>,
    /// Attachment / transcription intake cap (MiB). Default 25.
    pub max_upload_mb: usize,
    /// Generic REST body cap (MiB). Default 32.
    pub max_body_mb: usize,
    pub rate_per_min: u32,
    pub rate_burst: u32,
    /// Capacity of every tokio mpsc channel in the WS proxy. Default 128.
    pub ws_channel_capacity: usize,
    /// Single-use ticket lifetime (seconds). Default 30.
    pub ticket_ttl_secs: u64,
    pub allow_public_bind: bool,
}

fn env_str(key: &str) -> Option<String> {
    env::var(key).ok().filter(|v| !v.trim().is_empty())
}

fn env_bool(key: &str) -> Option<bool> {
    env_str(key).map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
}

fn env_usize(key: &str) -> Option<usize> {
    env_str(key).and_then(|v| v.parse().ok())
}

fn env_u32(key: &str) -> Option<u32> {
    env_str(key).and_then(|v| v.parse().ok())
}

fn env_u64(key: &str) -> Option<u64> {
    env_str(key).and_then(|v| v.parse().ok())
}

/// Trim a trailing slash so origin + path concatenation never doubles it.
pub fn trim_origin(origin: &str) -> String {
    origin.trim_end_matches('/').to_string()
}

impl Config {
    pub fn load() -> Result<Config, String> {
        let file_cfg: FileConfig = match env_str("HERMES_CONFIG_FILE") {
            Some(path) => {
                let text = std::fs::read_to_string(&path)
                    .map_err(|e| format!("cannot read config file {path}: {e}"))?;
                let cfg: FileConfig = serde_json::from_str(&text)
                    .map_err(|e| format!("cannot parse config file {path}: {e}"))?;
                if cfg.push_ignored.is_some() {
                    tracing::warn!(
                        "config file contains push settings; push is env-only and the file values are ignored"
                    );
                }
                cfg
            }
            None => FileConfig::default(),
        };

        let pick_str = |env_v: Option<String>, file_v: Option<String>| env_v.or(file_v);
        let pick_bool = |env_v: Option<bool>, file_v: Option<bool>| env_v.or(file_v);
        let pick_usize = |env_v: Option<usize>, file_v: Option<usize>| env_v.or(file_v);
        let pick_u32 = |env_v: Option<u32>, file_v: Option<u32>| env_v.or(file_v);
        let pick_u64 = |env_v: Option<u64>, file_v: Option<u64>| env_v.or(file_v);

        let origin_raw = pick_str(env_str("HERMES_ORIGIN"), file_cfg.hermes_origin)
            .ok_or_else(|| "HERMES_ORIGIN is required (e.g. http://127.0.0.1:9119)".to_string())?;
        if !origin_raw.starts_with("http://") && !origin_raw.starts_with("https://") {
            return Err("HERMES_ORIGIN must start with http:// or https://".to_string());
        }
        let hermes_origin = trim_origin(&origin_raw);

        let listen_raw = pick_str(env_str("LISTEN_ADDR"), file_cfg.listen_addr)
            .unwrap_or_else(|| "127.0.0.1:9120".to_string());
        let listen_addr: SocketAddr = listen_raw
            .parse()
            .map_err(|_| format!("LISTEN_ADDR is not a valid socket address: {listen_raw}"))?;
        let allow_public_bind =
            pick_bool(env_bool("HERMES_ALLOW_PUBLIC_BIND"), file_cfg.allow_public_bind)
                .unwrap_or(false);
        if listen_addr.ip().is_unspecified() && !allow_public_bind {
            return Err(
                "refusing to bind 0.0.0.0 / [::] without HERMES_ALLOW_PUBLIC_BIND=1; \
                 bind a Tailscale/LAN address instead, or put an authenticated reverse proxy in front"
                    .to_string(),
            );
        }

        let trust_proxy_auth =
            pick_bool(env_bool("HERMES_TRUST_PROXY_AUTH"), file_cfg.trust_proxy_auth)
                .unwrap_or(false);
        let device_token = pick_str(env_str("HERMES_DEVICE_TOKEN"), file_cfg.device_token);
        if device_token.is_none() && !trust_proxy_auth {
            return Err(
                "HERMES_DEVICE_TOKEN is required (or set HERMES_TRUST_PROXY_AUTH=1 only \
                 when an authenticated reverse proxy in front already verifies the device)"
                    .to_string(),
            );
        }

        Ok(Config {
            hermes_origin,
            listen_addr,
            device_token,
            trust_proxy_auth,
            host_bearer: pick_str(env_str("HERMES_HOST_BEARER"), file_cfg.host_bearer),
            host_cookie: pick_str(env_str("HERMES_HOST_COOKIE"), file_cfg.host_cookie),
            max_upload_mb: pick_usize(env_usize("HERMES_MAX_UPLOAD_MB"), file_cfg.max_upload_mb)
                .unwrap_or(25),
            max_body_mb: pick_usize(env_usize("HERMES_MAX_BODY_MB"), file_cfg.max_body_mb)
                .unwrap_or(32),
            rate_per_min: pick_u32(env_u32("HERMES_RATE_PER_MIN"), file_cfg.rate_per_min)
                .unwrap_or(600),
            rate_burst: pick_u32(env_u32("HERMES_RATE_BURST"), file_cfg.rate_burst)
                .unwrap_or(120),
            ws_channel_capacity: pick_usize(
                env_usize("HERMES_WS_CHANNEL_CAPACITY"),
                file_cfg.ws_channel_capacity,
            )
            .unwrap_or(128),
            ticket_ttl_secs: pick_u64(env_u64("HERMES_TICKET_TTL_SECS"), file_cfg.ticket_ttl_secs)
                .unwrap_or(30),
            allow_public_bind,
        })
    }

    /// Upstream WebSocket URL for `/api/ws` on the Hermes host.
    /// v1 assumption (documented in README): the host WS accepts the same
    /// bearer credential as REST, sent as an `Authorization` header.
    pub fn upstream_ws_url(&self) -> String {
        let base = self
            .hermes_origin
            .replacen("https://", "wss://", 1)
            .replacen("http://", "ws://", 1);
        format!("{base}/api/ws")
    }

    /// Join the origin with a request path+query (path always starts with `/`).
    pub fn upstream_url(&self, path_and_query: &str) -> String {
        format!("{}{}", self.hermes_origin, path_and_query)
    }

    /// Origin with any userinfo redacted, for safe log lines.
    pub fn redacted_origin(&self) -> String {
        match self.hermes_origin.split_once("://") {
            Some((scheme, rest)) => {
                let host = rest.rsplit('@').next().unwrap_or(rest);
                format!("{scheme}://{host}")
            }
            None => "<redacted>".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_trailing_slashes() {
        assert_eq!(trim_origin("http://127.0.0.1:9119/"), "http://127.0.0.1:9119");
        assert_eq!(trim_origin("http://127.0.0.1:9119"), "http://127.0.0.1:9119");
    }

    #[test]
    fn upstream_ws_url_swaps_scheme() {
        let cfg = Config {
            hermes_origin: "http://127.0.0.1:9119".to_string(),
            listen_addr: "127.0.0.1:9120".parse().unwrap(),
            device_token: None,
            trust_proxy_auth: true,
            host_bearer: None,
            host_cookie: None,
            max_upload_mb: 25,
            max_body_mb: 32,
            rate_per_min: 600,
            rate_burst: 120,
            ws_channel_capacity: 128,
            ticket_ttl_secs: 30,
            allow_public_bind: false,
        };
        assert_eq!(cfg.upstream_ws_url(), "ws://127.0.0.1:9119/api/ws");
        assert_eq!(
            cfg.upstream_url("/api/status?x=1"),
            "http://127.0.0.1:9119/api/status?x=1"
        );
    }
}
