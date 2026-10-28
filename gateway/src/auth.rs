//! Device-credential verification, single-use ticket minting, and
//! revocation.
//!
//! Rules:
//! - Every protected request must present `Authorization: Bearer <device
//!   token>`. The token is either a per-device credential issued by QR
//!   pairing (verified against its hash in the device store), or —
//!   only while the store holds zero devices — the bootstrap
//!   `HERMES_DEVICE_TOKEN`. Once the first device pairs, the env token
//!   stops working: there is no shared secret left to leak. This
//!   transition is safe because no production deployment predates
//!   pairing (v0.1.2 never had a working pair flow).
//! - The proxy NEVER stores, logs, or forwards LLM provider credentials.
//!   The proxy holds only the host bearer/cookie from its own
//!   environment, which it attaches server-side and never returns.
//! - Production deployments should put an authenticated reverse proxy or
//!   a Tailscale ACL in front. `HERMES_TRUST_PROXY_AUTH=1` (no device
//!   token) is only for that case.
//! - Revocation is per-device: `hermes-gateway unpair <id>` (or POST
//!   /api/auth/revoke from the device itself) deletes the device and
//!   purges its tickets. There is no global kill switch anymore.

use axum::extract::{Extension, Request, State};
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

/// Device identity resolved by the middleware, stashed in the request
/// extensions for handlers that mint tickets: Some(device id) for a
/// per-device token, None for env-bootstrap / trust-proxy auth.
#[derive(Clone, Debug)]
pub struct AuthDevice(pub Option<String>);

/// Authenticate a request against the device store and the bootstrap
/// rule. Ok(Some(id)) = per-device token, Ok(None) = env-bootstrap
/// token or trust-proxy mode, Err(()) = deny. Fail-closed: a store
/// error denies the request rather than letting it through.
pub async fn authenticate(
    state: &AppState,
    headers: &axum::http::HeaderMap,
) -> Result<Option<String>, ()> {
    match &state.config.device_token {
        // No device token configured: only reachable with
        // HERMES_TRUST_PROXY_AUTH=1, i.e. an authenticated reverse proxy
        // in front is doing the verification.
        None => Ok(None),
        Some(expected) => {
            let provided = extract_bearer(headers).ok_or(())?;
            let store_empty = state.pair_store.device_count().unwrap_or(usize::MAX) == 0;
            if store_empty && verify_token(&provided, expected) {
                return Ok(None);
            }
            match state.pair_store.verify_device_token(&provided) {
                Ok(Some(id)) => {
                    let _ = state.pair_store.touch_device(&id);
                    Ok(Some(id))
                }
                _ => Err(()),
            }
        }
    }
}

/// Axum middleware applied to the protected router. `/healthz`,
/// `/api/gbots`, `/api/pair`, `/api/ws` (ticket-or-bearer auth inside
/// its handler), and `/api/display/ws` (ticket auth inside its handler)
/// are NOT in that router.
pub async fn device_auth_middleware(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Response {
    match authenticate(&state, req.headers()).await {
        Ok(device) => {
            req.extensions_mut().insert(AuthDevice(device));
            next.run(req).await
        }
        Err(()) => unauthorized(),
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
/// needs a host ticket of its own. The ticket is bound to the calling
/// device, so unpairing the device purges it.
pub async fn mint_ticket_handler(
    State(state): State<AppState>,
    Extension(AuthDevice(device)): Extension<AuthDevice>,
) -> Response {
    let (ticket, ttl) = state.mint_ticket(TicketPurpose::Ws, None, device).await;
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

/// POST /api/auth/revoke — revoke the CALLING device: delete it from
/// the store and purge its tickets. Device-authenticated (middleware),
/// so only a holder of that device's token can revoke it. In
/// env-bootstrap / trust-proxy mode there is no device to revoke, so
/// this only clears outstanding tickets.
pub async fn revoke_handler(
    State(state): State<AppState>,
    Extension(AuthDevice(device)): Extension<AuthDevice>,
) -> Response {
    match device {
        Some(id) => {
            let _ = state.pair_store.remove_device(&id);
            state.purge_device_tickets(&id).await;
            tracing::info!("device revoked: {id}");
        }
        None => {
            state.clear_tickets().await;
            tracing::info!("tickets cleared (no calling device to revoke)");
        }
    }
    (StatusCode::OK, Json(RevokeResponse { revoked: true })).into_response()
}
