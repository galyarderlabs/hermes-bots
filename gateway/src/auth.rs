//! Device-credential verification, single-use ticket minting, and
//! revocation.
//!
//! Rules:
//! - Every protected request must present `Authorization: Bearer <device
//!   token>` matching `HERMES_DEVICE_TOKEN` (or the config-file equivalent).
//!   The comparison is constant-time over equal-length inputs (via the
//!   `subtle` crate); a length mismatch fails closed without comparison.
//! - The proxy NEVER stores, logs, or forwards LLM provider credentials.
//!   Password/PKCE exchanges are passed through to the host (see
//!   proxy.rs); the proxy holds only the host bearer/cookie from its own
//!   environment, which it attaches server-side and never returns.
//! - Production deployments should put an authenticated reverse proxy or
//!   a Tailscale ACL in front and rotate the device token regularly.
//!   `HERMES_TRUST_PROXY_AUTH=1` (no device token) is only for that case.

use axum::extract::{Request, State};
use axum::http::header::AUTHORIZATION;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Json, Response};
use serde::Serialize;
use subtle::ConstantTimeEq;

use crate::state::{AppState, TicketPurpose};

#[derive(Serialize)]
struct ErrorBody {
    error: &'static str,
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(ErrorBody {
            error: "unauthorized",
        }),
    )
        .into_response()
}

/// Extract a `Bearer <token>` value from headers. Returns None for any
/// other shape. The value itself is never logged.
pub fn extract_bearer(headers: &axum::http::HeaderMap) -> Option<String> {
    let value = headers.get(AUTHORIZATION)?.to_str().ok()?;
    let token = value.strip_prefix("Bearer ")?;
    if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    }
}

/// Constant-time-ish comparison: equal lengths compared in constant time,
/// differing lengths rejected outright (length alone is not secret here).
pub fn verify_token(provided: &str, expected: &str) -> bool {
    if provided.len() != expected.len() {
        return false;
    }
    provided.as_bytes().ct_eq(expected.as_bytes()).unwrap_u8() == 1
}

/// Axum middleware applied to the protected router. `/healthz`, `/api/ws`
/// (ticket-or-bearer auth inside its handler), and `/api/display/ws`
/// (ticket auth inside its handler) are NOT in that router.
pub async fn device_auth_middleware(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    if state.is_revoked().await {
        return unauthorized();
    }
    match &state.config.device_token {
        // No device token configured: only reachable with
        // HERMES_TRUST_PROXY_AUTH=1, i.e. an authenticated reverse proxy
        // in front is doing the verification.
        None => next.run(req).await,
        Some(expected) => match extract_bearer(req.headers()) {
            Some(provided) if verify_token(&provided, expected) => next.run(req).await,
            _ => unauthorized(),
        },
    }
}

#[derive(Serialize)]
struct TicketResponse {
    ticket: String,
    expires_in_secs: u64,
    purpose: &'static str,
}

/// POST /api/auth/ws-ticket — mint a short-lived, single-use ticket for
/// the proxy's own `/api/ws`. Device-authenticated (middleware).
/// NOTE: this mints the PROXY's ticket. The proxy attaches the host
/// credential server-side when it dials upstream, so the phone never
/// needs a host ticket of its own.
pub async fn mint_ticket_handler(State(state): State<AppState>) -> Response {
    let (ticket, ttl) = state.mint_ticket(TicketPurpose::Ws, None).await;
    tracing::info!("ws ticket minted");
    (
        StatusCode::OK,
        Json(TicketResponse {
            ticket,
            expires_in_secs: ttl,
            purpose: "ws",
        }),
    )
        .into_response()
}

#[derive(Serialize)]
struct RevokeResponse {
    revoked: bool,
}

/// POST /api/auth/revoke — invalidate the device-token entry in memory
/// and clear all outstanding tickets. Device-authenticated (middleware),
/// so only a holder of the current token can revoke it.
/// Permanent revocation = rotate HERMES_DEVICE_TOKEN and restart; a
/// restart restores the env token by design (documented in README).
pub async fn revoke_handler(State(state): State<AppState>) -> Response {
    state.revoke_all().await;
    tracing::info!("device token revoked (in-memory); outstanding tickets cleared");
    (StatusCode::OK, Json(RevokeResponse { revoked: true })).into_response()
}
