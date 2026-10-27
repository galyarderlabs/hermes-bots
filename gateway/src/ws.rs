//! WebSocket proxy: `/api/ws` NDJSON JSON-RPC fan-in/fan-out, and the
//! `/api/display/ws` RFB bridge STUB.
//!
//! `/api/ws` contract (from the port spec §5–§6):
//! - One durable upstream connection per mobile connection. Lines are
//!   forwarded VERBATIM in both directions: ordered `seq` passthrough is
//!   preserved by using a single writer task per direction, and the proxy
//!   never synthesises, reorders, or rewrites a Hermes frame.
//! - Per-session routing: every line is parsed ONLY to extract
//!   `session_id`/`sid` (and, for upstream events, the `type`) for the
//!   live-session registry and diagnostics. Message content is never
//!   logged or stored.
//! - Backpressure is real: each direction runs through a bounded tokio
//!   mpsc channel (capacity from config, default 128). When the channel
//!   is full, `send().await` waits, which pauses the reader task, which
//!   pauses socket reads. A slow phone consumer pauses upstream reads.
//!   There is NO unbounded buffering and NO silent message drop for
//!   NDJSON text lines (binary frames are not NDJSON and are logged +
//!   dropped, as documented in README).
//! - Auth: device bearer header, or a single-use `?ticket=` minted by
//!   POST /api/auth/ws-ticket. A failed auth returns 401, never an
//!   upgrade.
//! - Upstream dial retries with exponential backoff (capped). If the
//!   upstream socket drops mid-connection, the mobile socket is torn
//!   down so the client re-resumes cleanly through its own reconnect
//!   logic — the proxy never replays or re-submits a turn, and never
//!   invents a host `turn.recover` call. Turn re-attach is CONDITIONAL:
//!   if the host's `gateway.ready` payload advertises a turn-recovery
//!   method, the client may use it; otherwise the client reconciles
//!   from `GET /api/sessions/{id}/messages` (the transcript endpoint).
//!   The proxy logs what `gateway.ready` advertised; it does not act on
//!   unadvertised methods.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response, Json};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::protocol::Message as TungMessage;

use crate::auth::{extract_bearer, verify_token};
use crate::ratelimit::ConnectionBucket;
use crate::state::{AppState, TicketPurpose};

/// Upstream WebSocket stream type (plain ws/wss over TCP).
pub type UpstreamSocket = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;

/// Dial the Hermes host's `/api/ws`, attaching the host credential
/// server-side (bearer and/or cookie from env/config). The phone's
/// device credential is NEVER forwarded upstream. Returns only the
/// socket; the handshake response is discarded.
pub async fn dial_upstream(
    state: &AppState,
) -> Result<UpstreamSocket, tokio_tungstenite::tungstenite::Error> {
    let url = state.config.upstream_ws_url();
    if state.config.host_bearer.is_none() && state.config.host_cookie.is_none() {
        let (socket, _) = tokio_tungstenite::connect_async(url).await?;
        Ok(socket)
    } else {
        let mut builder = http::Request::builder().uri(&url);
        if let Some(bearer) = &state.config.host_bearer {
            builder = builder.header("authorization", format!("Bearer {bearer}"));
        }
        if let Some(cookie) = &state.config.host_cookie {
            builder = builder.header("cookie", cookie.clone());
        }
        // Builder failure here is unreachable in practice (the URI is
        // built from the validated origin); map it to a plain error.
        let request = builder
            .body(())
            .map_err(|_| tokio_tungstenite::tungstenite::Error::ConnectionClosed)?;
        let (socket, _) = tokio_tungstenite::connect_async(request).await?;
        Ok(socket)
    }
}

async fn dial_upstream_with_backoff(state: &AppState) -> Option<UpstreamSocket> {
    // 0.5s, 1s, 2s, 4s, 8s, 16s, 30s, then give up (caller closes 1011).
    let delays = [500u64, 1000, 2000, 4000, 8000, 16000, 30000];
    for (attempt, delay_ms) in delays.iter().enumerate() {
        match dial_upstream(state).await {
            Ok(socket) => return Some(socket),
            Err(e) => {
                tracing::warn!(
                    "upstream dial attempt {} failed ({e}); retry in {delay_ms}ms",
                    attempt + 1
                );
                tokio::time::sleep(Duration::from_millis(*delay_ms)).await;
            }
        }
    }
    None
}

/// Extract `session_id` (fallback `sid`) from a JSON-RPC line, for
/// routing/registry purposes only. Returns None for non-JSON lines.
fn line_session_id(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    // Client→host request: params.session_id. Host→client event:
    // params.session_id or params.sid.
    value
        .get("params")
        .and_then(|p| p.get("session_id").or_else(|| p.get("sid")))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string())
}

/// Snoop (never modify) an upstream line: logs whether the
/// `gateway.ready` event advertises turn recovery.
fn snoop_gateway_ready(line: &str) {
    let value: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return,
    };
    let is_ready = value.get("method").and_then(|m| m.as_str()) == Some("event")
        && value
            .get("params")
            .and_then(|p| p.get("type"))
            .and_then(|t| t.as_str())
            == Some("gateway.ready");
    if is_ready {
        let advertises_recovery = line.contains("turn.recover") || line.contains("turn.status");
        tracing::info!(
            "gateway.ready observed; turn_recovery_advertised={advertises_recovery} (client reconciles from transcript when false)"
        );
    }
}

enum MobileOut {
    Text(String),
    Pong,
}

enum UpOut {
    Text(String),
    Pong,
}

/// GET /api/ws — mobile WebSocket entry point.
pub async fn ws_handler(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
    headers: axum::http::HeaderMap,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Response {
    if !authorize_ws(&state, &headers, &params).await {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "unauthorized" })),
        )
            .into_response();
    }
    ws.on_upgrade(move |socket| run_connection_body(socket, state))
}

async fn authorize_ws(
    state: &AppState,
    headers: &axum::http::HeaderMap,
    params: &std::collections::HashMap<String, String>,
) -> bool {
    if state.is_revoked().await {
        return false;
    }
    match &state.config.device_token {
        None => true, // HERMES_TRUST_PROXY_AUTH=1: reverse proxy verifies.
        Some(expected) => {
            if let Some(provided) = extract_bearer(headers) {
                if verify_token(&provided, expected) {
                    return true;
                }
            }
            if let Some(ticket) = params.get("ticket") {
                if state
                    .consume_ticket(ticket, TicketPurpose::Ws)
                    .await
                    .is_some()
                {
                    tracing::info!("ws ticket accepted (single-use, consumed)");
                    return true;
                }
            }
            false
        }
    }
}

async fn run_connection_body(mut mobile: WebSocket, state: AppState) {
    let Some(upstream) = dial_upstream_with_backoff(&state).await else {
        let _ = mobile
            .send(Message::Close(Some(CloseFrame {
                code: 1011,
                reason: "upstream unavailable".into(),
            })))
            .await;
        return;
    };
    tracing::info!("mobile ws connected; upstream ws established");

    let capacity = state.config.ws_channel_capacity;
    let (tx_up, mut rx_up) = mpsc::channel::<UpOut>(capacity);
    let (tx_down, mut rx_down) = mpsc::channel::<MobileOut>(capacity);

    let (mut mobile_sink, mut mobile_stream) = mobile.split();
    let (mut upstream_sink, mut upstream_stream) = upstream.split();

    // Sessions seen on this connection (for the push-suppression
    // registry). Readers insert here AND mark live exactly once each.
    let conn_sessions: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));

    // Mobile -> upstream reader.
    let tx_up_r = tx_up.clone();
    let tx_down_for_ping = tx_down.clone();
    let state_r = state.clone();
    let conn_r = conn_sessions.clone();
    let mobile_reader = async move {
        let mut bucket = ConnectionBucket::new(120.0, 30.0);
        while let Some(msg) = mobile_stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    let line: &str = &text;
                    if !bucket.check() {
                        tracing::warn!("mobile ws rate limit exceeded; closing connection");
                        break;
                    }
                    if let Some(sid) = line_session_id(line) {
                        let mut set = conn_r.lock().await;
                        if set.insert(sid.clone()) {
                            drop(set);
                            state_r.mark_one(&sid).await;
                        }
                    }
                    // Backpressure: awaits while the channel is full.
                    if tx_up_r.send(UpOut::Text(line.to_string())).await.is_err() {
                        break;
                    }
                }
                Ok(Message::Ping(_)) => {
                    if tx_down_for_ping.send(MobileOut::Pong).await.is_err() {
                        break;
                    }
                }
                Ok(Message::Pong(_)) => continue,
                Ok(Message::Close(_)) => break,
                Ok(Message::Binary(_)) => {
                    tracing::warn!("mobile ws binary frame dropped (NDJSON text only)");
                    continue;
                }
                Ok(_) => continue,
                Err(_) => break,
            }
        }
    };

    // Upstream -> mobile reader. Snoops gateway.ready, forwards verbatim.
    let tx_down_r = tx_down.clone();
    let tx_up_for_ping = tx_up.clone();
    let state_u = state.clone();
    let conn_u = conn_sessions.clone();
    let upstream_reader = async move {
        while let Some(msg) = upstream_stream.next().await {
            match msg {
                Ok(TungMessage::Text(text)) => {
                    snoop_gateway_ready(&text);
                    if let Some(sid) = line_session_id(&text) {
                        let mut set = conn_u.lock().await;
                        if set.insert(sid.clone()) {
                            drop(set);
                            state_u.mark_one(&sid).await;
                        }
                    }
                    // Backpressure: awaits while the channel is full, so a
                    // slow phone pauses upstream reads.
                    if tx_down_r.send(MobileOut::Text(text)).await.is_err() {
                        break;
                    }
                }
                Ok(TungMessage::Ping(_)) => {
                    if tx_up_for_ping.send(UpOut::Pong).await.is_err() {
                        break;
                    }
                }
                Ok(TungMessage::Pong(_)) => continue,
                Ok(TungMessage::Close(_)) => break,
                Ok(TungMessage::Binary(_)) => {
                    tracing::warn!("upstream binary frame dropped (NDJSON text only)");
                    continue;
                }
                Ok(TungMessage::Frame(_)) => continue,
                Ok(_) => continue,
                Err(_) => break,
            }
        }
    };

    // Upstream writer (single task => ordered passthrough).
    let upstream_writer = async move {
        while let Some(out) = rx_up.recv().await {
            let res = match out {
                UpOut::Text(line) => upstream_sink.send(TungMessage::Text(line)).await,
                UpOut::Pong => {
                    upstream_sink
                        .send(TungMessage::Pong(bytes::Bytes::new()))
                        .await
                }
            };
            if res.is_err() {
                break;
            }
        }
        let _ = upstream_sink.close().await;
    };

    // Mobile writer (single task => ordered passthrough).
    let mobile_writer = async move {
        while let Some(out) = rx_down.recv().await {
            let res = match out {
                MobileOut::Text(line) => mobile_sink.send(Message::Text(line.into())).await,
                MobileOut::Pong => mobile_sink.send(Message::Pong(bytes::Bytes::new())).await,
            };
            if res.is_err() {
                break;
            }
        }
        let _ = mobile_sink.close().await;
    };

    // Run all four pumps. When ANY pump ends, the connection is over:
    // abort the rest so no task outlives the socket and no upstream
    // socket is orphaned. (The original channel senders are dropped
    // first, so writers also end once readers are gone.)
    drop(tx_up);
    drop(tx_down);
    let mut pumps = tokio::task::JoinSet::new();
    pumps.spawn(mobile_reader);
    pumps.spawn(upstream_reader);
    pumps.spawn(upstream_writer);
    pumps.spawn(mobile_writer);
    let _ = pumps.join_next().await;
    pumps.abort_all();
    while pumps.join_next().await.is_some() {}

    let sessions = conn_sessions.lock().await.clone();
    state.unmark_live(&sessions).await;
    tracing::info!("mobile ws connection closed");
}

#[derive(Serialize)]
pub struct DisplayTicketInfo {
    pub ticket: String,
    pub viewer_id: String,
    pub path: &'static str,
    pub expires_in_secs: u64,
}

/// GET /api/display/ws — RFB bridge STUB (see README "Stub vs live").
/// Validates the single-use display ticket, enforces the single-holder
/// lease gate, then accepts frames and DROPS them with a log line:
/// no RFB bytes are fabricated and nothing is forwarded upstream in v1.
/// TODO(RFB): dial the host RFB socket here and forward holder frames.
pub async fn display_ws_handler(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Response {
    let ticket = match params.get("ticket") {
        Some(t) => t.clone(),
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "unauthorized" })),
            )
                .into_response();
        }
    };
    let viewer_id = match state.consume_ticket(&ticket, TicketPurpose::Display).await {
        Some(Some(v)) => v,
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "unauthorized" })),
            )
                .into_response();
        }
    };
    ws.on_upgrade(move |socket| run_display_bridge(socket, state, viewer_id))
}

async fn run_display_bridge(mut socket: WebSocket, state: AppState, viewer_id: String) {
    // Single-holder lease gate: only one display viewer at a time.
    {
        let mut holder = state.display_holder.lock().await;
        if let Some(existing) = holder.as_ref() {
            if existing != &viewer_id {
                tracing::warn!("display bridge: non-holder viewer connection refused (lease held)");
                let _ = socket
                    .send(Message::Close(Some(CloseFrame {
                        code: 1008,
                        reason: "display lease held by another viewer".into(),
                    })))
                    .await;
                return;
            }
        }
        *holder = Some(viewer_id.clone());
    }
    tracing::info!("display bridge stub open (lease holder connected)");

    while let Some(msg) = socket.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                let frame: &str = &text;
                // Per-frame lease check: a frame naming another viewer is
                // dropped with a log line, never forwarded.
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(frame) {
                    if let Some(v) = value.get("viewer_id").and_then(|v| v.as_str()) {
                        if v != viewer_id {
                            tracing::warn!("display bridge: non-holder frame dropped (stub)");
                            continue;
                        }
                    }
                }
                // STUB: holder frame received; NOT forwarded upstream.
                // TODO(RFB): forward pointer/keyboard frames to the host
                // RFB socket for this viewer_id.
                tracing::info!("display bridge stub: holder frame dropped (RFB not implemented)");
            }
            Ok(Message::Binary(_)) => {
                tracing::info!("display bridge stub: binary frame dropped (RFB not implemented)");
            }
            Ok(Message::Ping(_)) => {
                if socket.send(Message::Pong(bytes::Bytes::new())).await.is_err() {
                    break;
                }
            }
            Ok(Message::Pong(_)) => continue,
            Ok(Message::Close(_)) => break,
            Ok(_) => continue,
            Err(_) => break,
        }
    }

    {
        let mut holder = state.display_holder.lock().await;
        if holder.as_deref() == Some(viewer_id.as_str()) {
            *holder = None;
        }
    }
    tracing::info!("display bridge stub closed");
}

/// Helper used by proxy.rs: mint a display ticket + viewer_id pair.
pub async fn mint_display_ticket(state: &AppState) -> DisplayTicketInfo {
    let bytes: [u8; 8] = rand::random();
    let viewer_id = format!("viewer-{}", hex::encode(bytes));
    let (ticket, ttl) = state
        .mint_ticket(TicketPurpose::Display, Some(viewer_id.clone()))
        .await;
    DisplayTicketInfo {
        ticket,
        viewer_id,
        path: "/api/display/ws",
        expires_in_secs: ttl,
    }
}
