//! Expo Push Service notifications, metadata-only.
//!
//! When the mobile socket is down, the proxy's durable host subscription
//! (see `run_push_watcher`) may emit a push ticket containing ONLY:
//!   - the Bot's name (title),
//!   - a generic body per event kind ("Finished", "Needs your approval"),
//!   - data: `{ kind, id }` (chat/group/task id).
//! NEVER message content the user did not opt into, NEVER secrets,
//! NEVER tokens. Quiet hours (default 22:00–07:00) and per-Bot
//! preferences are enforced proxy-side, so a muted Bot cannot wake the
//! phone via a stale client setting.
//!
//! Push settings come from the environment ONLY:
//!   HERMES_PUSH_TOKENS           comma-separated Expo push tokens
//!   HERMES_PUSH_QUIET_START      default 22
//!   HERMES_PUSH_QUIET_END        default 7
//!   HERMES_PUSH_INCLUDE_PROFILES comma-separated profile names; empty = all
//!
//! If no push tokens are configured, push is DISABLED with one clear log
//! line at startup — never an error loop.

use std::env;

use serde::Serialize;

use crate::state::AppState;
use crate::ws::dial_upstream;

const EXPO_PUSH_URL: &str = "https://exp.host/--/api/v2/push/send";

#[derive(Debug, Clone)]
pub struct PushConfig {
    pub tokens: Vec<String>,
    pub quiet_start: u32,
    pub quiet_end: u32,
    pub include_profiles: Vec<String>,
}

impl PushConfig {
    pub fn from_env() -> PushConfig {
        let split = |key: &str| -> Vec<String> {
            env::var(key)
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        };
        let hour = |key: &str, default: u32| -> u32 {
            env::var(key)
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(default)
                .min(23)
        };
        PushConfig {
            tokens: split("HERMES_PUSH_TOKENS"),
            quiet_start: hour("HERMES_PUSH_QUIET_START", 22),
            quiet_end: hour("HERMES_PUSH_QUIET_END", 7),
            include_profiles: split("HERMES_PUSH_INCLUDE_PROFILES"),
        }
    }

    pub fn enabled(&self) -> bool {
        !self.tokens.is_empty()
    }
}

/// Pure quiet-hours test, including the wrap-around-midnight case
/// (22:00–07:00). `hour` is the local hour 0–23.
pub fn is_quiet_hour(hour: u32, start: u32, end: u32) -> bool {
    if start == end {
        return false;
    }
    if start < end {
        hour >= start && hour < end
    } else {
        hour >= start || hour < end
    }
}

fn current_hour_local() -> u32 {
    use chrono::Timelike;
    chrono::Local::now().hour()
}

/// All proxy-side gates: push configured, outside quiet hours, Bot
/// allowed by the include list, and no live mobile socket for the
/// session. Returns false (silently, no log of content) otherwise.
pub fn should_notify(cfg: &PushConfig, bot: &str, session_live: bool) -> bool {
    if !cfg.enabled() || session_live {
        return false;
    }
    if is_quiet_hour(current_hour_local(), cfg.quiet_start, cfg.quiet_end) {
        return false;
    }
    if !cfg.include_profiles.is_empty() && !cfg.include_profiles.iter().any(|p| p == bot) {
        return false;
    }
    true
}

#[derive(Serialize)]
struct ExpoMessage {
    to: String,
    title: String,
    body: String,
    data: ExpoData,
}

#[derive(Serialize)]
struct ExpoData {
    kind: String,
    id: String,
}

/// Emit one push ticket per configured token. `kind` is one of
/// "finished" / "approval" / "mention"; `id` is a chat/group/task id.
/// The body is a fixed generic string per kind — never message text.
pub async fn send_push(state: &AppState, bot: &str, kind: &str, id: &str) {
    let body = match kind {
        "finished" => "Finished",
        "approval" => "Needs your approval",
        "mention" => "New mention",
        _ => "New update",
    };
    for token in &state.push.tokens {
        let msg = ExpoMessage {
            to: token.clone(),
            title: bot.to_string(),
            body: body.to_string(),
            data: ExpoData {
                kind: kind.to_string(),
                id: id.to_string(),
            },
        };
        match state.http.post(EXPO_PUSH_URL).json(&msg).send().await {
            Ok(resp) => {
                tracing::info!(
                    "expo push sent kind={kind} status={}",
                    resp.status().as_u16()
                );
            }
            Err(e) => {
                // Log the failure class only — never the token or payload.
                tracing::warn!("expo push failed kind={kind}: {e}");
            }
        }
    }
}

/// Durable host subscription for push only. Opens its own upstream
/// `/api/ws` connection, watches host events, and emits metadata-only
/// pushes when the mobile socket for that session is down. Reconnects
/// with capped exponential backoff forever (this is a background
/// watcher, not a user-visible connection: a drop must not page anyone).
///
/// Only terminal/completion event types produce pushes. `sessions.changed`
/// is a bare refetch signal and never produces a push on its own.
pub async fn run_push_watcher(state: AppState) {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::protocol::Message as TungMessage;

    let mut delay_secs: u64 = 1;
    loop {
        match dial_upstream(&state).await {
            Ok(mut socket) => {
                tracing::info!("push watcher connected to Hermes host");
                delay_secs = 1;
                while let Some(msg) = socket.next().await {
                    let text = match msg {
                        Ok(TungMessage::Text(t)) => t,
                        Ok(TungMessage::Ping(_)) => {
                            let _ = socket.send(TungMessage::Pong(bytes::Bytes::new())).await;
                            continue;
                        }
                        Ok(_) => continue,
                        Err(_) => break,
                    };
                    // Parse for routing metadata only: event type, bot
                    // profile, session id. Message content is never read
                    // into a logged or forwarded value.
                    let value: serde_json::Value = match serde_json::from_str(&text) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    let is_event = value.get("method").and_then(|m| m.as_str()) == Some("event");
                    if !is_event {
                        continue;
                    }
                    let params = match value.get("params") {
                        Some(p) => p,
                        None => continue,
                    };
                    let event_type = params.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    let kind = match event_type {
                        "message.complete" | "turn.end" => "finished",
                        _ => continue,
                    };
                    let bot = params
                        .get("profile")
                        .and_then(|p| p.as_str())
                        .unwrap_or("Hermes");
                    let session_id = params
                        .get("session_id")
                        .and_then(|s| s.as_str())
                        .or_else(|| params.get("sid").and_then(|s| s.as_str()))
                        .unwrap_or("");
                    let live = if session_id.is_empty() {
                        false
                    } else {
                        state.is_live(session_id).await
                    };
                    if should_notify(&state.push, bot, live) {
                        tracing::info!("pushing kind={kind} bot={bot} session_live={live}");
                        send_push(&state, bot, kind, session_id).await;
                    }
                }
                tracing::warn!("push watcher upstream socket ended; reconnecting");
            }
            Err(e) => {
                tracing::warn!("push watcher dial failed ({e}); retry in {delay_secs}s");
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(delay_secs)).await;
        delay_secs = (delay_secs * 2).min(60);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quiet_hours_wrap_midnight() {
        // Default 22:00–07:00.
        assert!(is_quiet_hour(23, 22, 7));
        assert!(is_quiet_hour(2, 22, 7));
        assert!(!is_quiet_hour(7, 22, 7));
        assert!(!is_quiet_hour(12, 22, 7));
        assert!(!is_quiet_hour(21, 22, 7));
    }

    #[test]
    fn quiet_hours_daytime_window() {
        assert!(is_quiet_hour(13, 12, 14));
        assert!(!is_quiet_hour(15, 12, 14));
    }
}
