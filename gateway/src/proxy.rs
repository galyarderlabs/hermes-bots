//! REST passthrough, status probe, display tickets, and attachment intake.
//!
//! Forwarding rules (spec §5.5, §9):
//! - Method, path, query string, and body are preserved verbatim.
//! - The phone's device credential is STRIPPED, never forwarded to the
//!   host. The host credential (bearer and/or cookie from env/config) is
//!   attached server-side. Provider keys never pass through either hop
//!   in a form the app can read.
//! - The host's status, body, and errors are returned verbatim. If the
//!   proxy cannot forward, it rejects with a plain error (502) — it
//!   never synthesises a Hermes response.
//! - Auth routes (`/auth/*`, `/api/auth/*` except the proxy's own
//!   `/api/auth/ws-ticket` and `/api/auth/revoke`) additionally forward
//!   the phone's Cookie header and return `Set-Cookie` verbatim, because
//!   password/PKCE sign-in and token refresh are host-owned cookie
//!   flows. All other routes strip both.
//! - Structured logs carry method, path, status, and latency only —
//!   never tokens, headers, or bodies.

use std::time::Instant;

use axum::body::{to_bytes, Bytes};
use axum::extract::{Multipart, Request, State};
use axum::http::header::{ACCEPT, ACCEPT_LANGUAGE, CONTENT_TYPE, COOKIE, SET_COOKIE};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response, Json};
use futures_util::SinkExt;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::protocol::Message as TungMessage;

use crate::state::AppState;
use crate::ws::{dial_upstream, mint_display_ticket};

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// GET /healthz — the proxy's own health. No auth. No host contact.
pub async fn health_handler() -> Response {
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "status": "ok",
            "service": "hermes-gateway",
            "version": VERSION,
        })),
    )
        .into_response()
}

fn plain_error(status: StatusCode, error: &'static str) -> Response {
    (
        status,
        Json(serde_json::json!({ "error": error })),
    )
        .into_response()
}

/// GET /api/status — the mobile probe target. Forwards to the host and,
/// when the host body is a JSON object, adds a `proxy` info object.
/// When the host body is not JSON, it is returned verbatim with the
/// proxy version in a response header instead. Host unreachable => 502.
pub async fn status_handler(State(state): State<AppState>, uri: Uri) -> Response {
    let started = Instant::now();
    let target = state.upstream_url(path_and_query(&uri));
    let mut req = state.http.get(&target);
    req = attach_host_credential(req, &state);
    let resp = match req.send().await {
        Ok(r) => r,
        Err(_) => {
            tracing::warn!("status probe: upstream unreachable");
            return plain_error(StatusCode::BAD_GATEWAY, "upstream_unreachable");
        }
    };
    let status = resp.status();
    let content_type = resp
        .headers()
        .get(CONTENT_TYPE)
        .cloned();
    let body = match resp.bytes().await {
        Ok(b) => b,
        Err(_) => return plain_error(StatusCode::BAD_GATEWAY, "upstream_unreachable"),
    };
    tracing::info!(
        "GET /api/status -> {} in {}ms",
        status.as_u16(),
        started.elapsed().as_millis()
    );
    let mut headers = HeaderMap::new();
    headers.insert("x-hermes-proxy", format!("hermes-gateway/{VERSION}").parse().unwrap());
    match serde_json::from_slice::<serde_json::Value>(&body) {
        Ok(mut value) if value.is_object() => {
            value.as_object_mut().unwrap().insert(
                "proxy".to_string(),
                serde_json::json!({
                    "version": VERSION,
                    "ws": "/api/ws",
                    "push_enabled": state.push.enabled(),
                    // Turn re-attach is conditional on gateway.ready
                    // advertising it; the client reconciles from the
                    // transcript endpoint otherwise (see ws.rs).
                    "turn_recovery": "conditional-on-gateway-ready",
                }),
            );
            let out = serde_json::to_vec(&value).unwrap_or_else(|_| body.to_vec());
            if let Some(ct) = content_type {
                headers.insert(CONTENT_TYPE, ct);
            }
            (status, headers, Bytes::from(out)).into_response()
        }
        _ => {
            if let Some(ct) = content_type {
                headers.insert(CONTENT_TYPE, ct);
            }
            (status, headers, body).into_response()
        }
    }
}

/// POST /api/display/ticket — mint a single-use display ticket bound to
/// a fresh viewer_id. Device-authenticated (middleware). The app then
/// opens `/api/display/ws?ticket=…` with that viewer_id; the host lease
/// itself is still acquired by the app via WS RPC
/// (`display.lease.acquire`), which remains authoritative.
pub async fn display_ticket_handler(State(state): State<AppState>) -> Response {
    let info = mint_display_ticket(&state).await;
    tracing::info!("display ticket minted");
    (StatusCode::OK, Json(info)).into_response()
}

fn path_and_query(uri: &Uri) -> String {
    uri.path_and_query()
        .map(|pq| pq.as_str().to_string())
        .unwrap_or_else(|| uri.path().to_string())
}

fn attach_host_credential(
    req: reqwest::RequestBuilder,
    state: &AppState,
) -> reqwest::RequestBuilder {
    let mut req = req;
    if let Some(bearer) = &state.config.host_bearer {
        req = req.header("authorization", format!("Bearer {bearer}"));
    }
    if let Some(cookie) = &state.config.host_cookie {
        req = req.header("cookie", cookie.clone());
    }
    req
}

/// Core forwarder. `forward_cookie` is true ONLY for host auth routes.
/// `limit_bytes` is the request-body cap; exceeding it yields 413.
async fn forward(
    state: &AppState,
    req: Request,
    limit_bytes: usize,
    forward_cookie: bool,
) -> Response {
    let started = Instant::now();
    let (parts, body) = req.into_parts();
    let method = parts.method.clone();
    let uri = parts.uri.clone();
    let path = uri.path().to_string();
    let target = state.upstream_url(&path_and_query(&uri));

    let bytes = match to_bytes(body, limit_bytes).await {
        Ok(b) => b,
        Err(_) => {
            tracing::warn!("{method} {path} rejected: body over limit");
            return plain_error(StatusCode::PAYLOAD_TOO_LARGE, "request_too_large");
        }
    };

    let req_method = match reqwest::Method::from_bytes(method.as_str().as_bytes()) {
        Ok(m) => m,
        Err(_) => return plain_error(StatusCode::BAD_REQUEST, "unsupported_method"),
    };
    let mut out = state.http.request(req_method, &target);
    // Forward a minimal safe header set. The phone's Authorization
    // (device token) is deliberately NOT copied.
    if let Some(v) = parts.headers.get(CONTENT_TYPE) {
        out = out.header(CONTENT_TYPE, v.clone());
    }
    if let Some(v) = parts.headers.get(ACCEPT) {
        out = out.header(ACCEPT, v.clone());
    }
    if let Some(v) = parts.headers.get(ACCEPT_LANGUAGE) {
        out = out.header(ACCEPT_LANGUAGE, v.clone());
    }
    if forward_cookie {
        if let Some(v) = parts.headers.get(COOKIE) {
            out = out.header(COOKIE, v.clone());
        }
    }
    out = attach_host_credential(out, state);
    if !bytes.is_empty() {
        out = out.body(bytes);
    }

    let resp = match out.send().await {
        Ok(r) => r,
        Err(_) => {
            tracing::warn!("{method} {path} upstream unreachable");
            return plain_error(StatusCode::BAD_GATEWAY, "upstream_unreachable");
        }
    };
    let status = match StatusCode::from_u16(resp.status().as_u16()) {
        Ok(s) => s,
        Err(_) => StatusCode::BAD_GATEWAY,
    };
    let mut headers = HeaderMap::new();
    if let Some(v) = resp.headers().get(CONTENT_TYPE) {
        headers.insert(CONTENT_TYPE, v.clone());
    }
    if forward_cookie {
        if let Some(v) = resp.headers().get(SET_COOKIE) {
            headers.insert(SET_COOKIE, v.clone());
        }
    }
    let body = match resp.bytes().await {
        Ok(b) => b,
        Err(_) => return plain_error(StatusCode::BAD_GATEWAY, "upstream_unreachable"),
    };
    tracing::info!(
        "{method} {path} -> {} in {}ms ({} bytes)",
        status.as_u16(),
        started.elapsed().as_millis(),
        body.len()
    );
    (status, headers, body).into_response()
}

/// Generic REST passthrough (sessions, profiles/sessions, model options,
/// cron, and anything under the listed prefixes). Body cap = max_body_mb.
pub async fn passthrough_handler(State(state): State<AppState>, req: Request) -> Response {
    let limit = state.config.max_body_mb * 1024 * 1024;
    forward(&state, req, limit, false).await
}

/// Upload-flavoured passthrough (e.g. `/api/audio/*` transcription).
/// Body cap = max_upload_mb.
pub async fn passthrough_upload_handler(
    State(state): State<AppState>,
    req: Request,
) -> Response {
    let limit = state.config.max_upload_mb * 1024 * 1024;
    forward(&state, req, limit, false).await
}

/// Host auth passthrough: password login, PKCE exchange, token refresh.
/// Forwards the host session cookie and returns Set-Cookie verbatim.
/// The proxy never stores provider keys and never sees them.
pub async fn passthrough_auth_handler(
    State(state): State<AppState>,
    req: Request,
) -> Response {
    let limit = state.config.max_body_mb * 1024 * 1024;
    forward(&state, req, limit, true).await
}

/// POST /api/attachments — attachment intake.
///
/// The phone uploads ONE file as multipart (`file` field, optional
/// `session_id` and `name` fields). The proxy:
///   1. streams the field in chunks, rejecting with 413 past the cap
///      (default 25 MiB, `HERMES_MAX_UPLOAD_MB`) — the file is held in
///      ONE bounded buffer, and base64-encoded exactly once;
///   2. hands the resulting data URL to the host's `file.attach` WS RPC
///      over a short-lived upstream connection (120 s timeout, per the
///      spec's file.attach timeout);
///   3. returns the host's reply verbatim (the app checks
///      `attached === true` and a `ref_text`, per spec §5.1).
///
/// The phone therefore never base64-encodes a large file through JS
/// string handling itself. Uploads larger than the cap are rejected
/// before any upstream call.
pub async fn attachment_handler(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Response {
    let cap = state.config.max_upload_mb * 1024 * 1024;
    let mut file_bytes: Vec<u8> = Vec::new();
    let mut file_name: Option<String> = None;
    let mut mime = "application/octet-stream".to_string();
    let mut session_id: Option<String> = None;

    while let Some(field) = match multipart.next_field().await {
        Ok(f) => f,
        Err(_) => return plain_error(StatusCode::BAD_REQUEST, "invalid_multipart"),
    } {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "file" => {
                file_name = field
                    .file_name()
                    .map(|s| s.to_string())
                    .or_else(|| Some("attachment".to_string()));
                if let Some(ct) = field.content_type() {
                    mime = ct.to_string();
                }
                let mut field = field;
                loop {
                    let chunk = match field.chunk().await {
                        Ok(Some(c)) => c,
                        Ok(None) => break,
                        Err(_) => {
                            return plain_error(StatusCode::BAD_REQUEST, "invalid_multipart")
                        }
                    };
                    if file_bytes.len() + chunk.len() > cap {
                        tracing::warn!("attachment rejected: over size cap");
                        return plain_error(StatusCode::PAYLOAD_TOO_LARGE, "attachment_too_large");
                    }
                    file_bytes.extend_from_slice(&chunk);
                }
            }
            "session_id" | "name" => {
                let mut text = Vec::new();
                let mut field = field;
                loop {
                    match field.chunk().await {
                        Ok(Some(c)) => text.extend_from_slice(&c),
                        Ok(None) => break,
                        Err(_) => {
                            return plain_error(StatusCode::BAD_REQUEST, "invalid_multipart")
                        }
                    }
                }
                let value = String::from_utf8_lossy(&text).into_owned();
                if name == "session_id" {
                    session_id = Some(value);
                } else {
                    file_name = Some(value);
                }
            }
            _ => {
                // Drain unknown fields without storing them.
                let mut field = field;
                loop {
                    match field.chunk().await {
                        Ok(Some(_)) => continue,
                        Ok(None) => break,
                        Err(_) => {
                            return plain_error(StatusCode::BAD_REQUEST, "invalid_multipart")
                        }
                    }
                }
            }
        }
    }

    let session_id = match session_id {
        Some(s) if !s.trim().is_empty() => s,
        _ => return plain_error(StatusCode::BAD_REQUEST, "session_id_required"),
    };
    if file_bytes.is_empty() {
        return plain_error(StatusCode::BAD_REQUEST, "file_required");
    }
    let name = file_name.unwrap_or_else(|| "attachment".to_string());

    // Exactly one base64 pass, into the data URL the host expects.
    let data_url = format!(
        "data:{mime};base64,{}",
        base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &file_bytes
        )
    );
    drop(file_bytes);

    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "file.attach",
        "params": { "session_id": session_id, "name": name, "data_url": data_url },
    });
    let request_text = request.to_string();
    drop(request);

    let (mut socket) = match dial_upstream(&state).await {
        Ok(socket) => socket,
        Err(_) => return plain_error(StatusCode::BAD_GATEWAY, "upstream_unreachable"),
    };
    if socket.send(TungMessage::Text(request_text)).await.is_err() {
        return plain_error(StatusCode::BAD_GATEWAY, "upstream_unreachable");
    }
    let reply = timeout(Duration::from_secs(120), async {
        use futures_util::StreamExt as _;
        while let Some(msg) = socket.next().await {
            match msg {
                Ok(TungMessage::Text(text)) => return Some(text),
                Ok(TungMessage::Ping(_)) => {
                    let _ = socket
                        .send(TungMessage::Pong(bytes::Bytes::new()))
                        .await;
                }
                Ok(_) => continue,
                Err(_) => return None,
            }
        }
        None
    })
    .await;
    let _ = socket.close(None).await;

    match reply {
        Ok(Some(text)) => {
            // Host reply verbatim (JSON-RPC result/error object).
            match serde_json::from_str::<serde_json::Value>(&text) {
                Ok(value) => (StatusCode::OK, Json(value)).into_response(),
                Err(_) => plain_error(StatusCode::BAD_GATEWAY, "upstream_bad_response"),
            }
        }
        _ => plain_error(StatusCode::BAD_GATEWAY, "upstream_unreachable"),
    }
}
