//! Hermes gateway proxy — single binary, runs NEXT TO the Hermes host.
//!
//! The phone talks to this proxy (over Tailscale/LAN, with a device
//! credential); the proxy talks to Hermes (loopback on the host, with
//! the host credential from its own environment). The proxy forwards —
//! it never re-implements Hermes, embeds a model, executes tools, or
//! stores provider credentials.

mod auth;
mod config;
mod proxy;
mod push;
mod ratelimit;
mod state;
mod ws;

use axum::middleware::from_fn_with_state;
use axum::routing::{any, get, post};
use axum::Router;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

use crate::config::Config;
use crate::push::PushConfig;
use crate::state::AppState;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("hermes_gateway=info")),
        )
        .init();

    let config = match Config::load() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("hermes-gateway: configuration error: {e}");
            std::process::exit(1);
        }
    };
    let push = PushConfig::from_env();
    if push.enabled() {
        tracing::info!(
            "push enabled: quiet hours {}:00-{}:00, per-bot filter: {}",
            push.quiet_start,
            push.quiet_end,
            if push.include_profiles.is_empty() {
                "all bots".to_string()
            } else {
                push.include_profiles.join(",")
            }
        );
    } else {
        tracing::info!("push disabled: no HERMES_PUSH_TOKENS configured (not an error)");
    }

    let state = AppState::new(config, push);
    let listen = state.config.listen_addr;
    let origin = state.config.redacted_origin();

    if state.push.enabled() {
        let watcher_state = state.clone();
        tokio::spawn(async move {
            push::run_push_watcher(watcher_state).await;
        });
    }

    // Protected routes: device auth + rate limit middleware.
    // /healthz, /api/ws, and /api/display/ws are NOT here: /healthz is
    // public by design, and the two WS routes authenticate inside their
    // handlers (bearer-or-ticket / ticket respectively).
    let protected = Router::new()
        .route("/api/status", get(proxy::status_handler))
        .route("/api/auth/ws-ticket", post(auth::mint_ticket_handler))
        .route("/api/auth/revoke", post(auth::revoke_handler))
        .route("/api/display/ticket", post(proxy::display_ticket_handler))
        .route("/api/attachments", post(proxy::attachment_handler))
        .route("/api/profiles/sessions", any(proxy::passthrough_handler))
        .route("/api/sessions/{*rest}", any(proxy::passthrough_handler))
        .route("/api/model/{*rest}", any(proxy::passthrough_handler))
        .route("/api/audio/{*rest}", any(proxy::passthrough_upload_handler))
        .route("/api/cron/{*rest}", any(proxy::passthrough_handler))
        // Host auth passthrough. Axum prefers the exact
        // /api/auth/ws-ticket and /api/auth/revoke routes above over
        // this wildcard for those paths.
        .route("/auth/{*rest}", any(proxy::passthrough_auth_handler))
        .route("/api/auth/{*rest}", any(proxy::passthrough_auth_handler))
        .layer(from_fn_with_state(
            state.clone(),
            auth::device_auth_middleware,
        ))
        .layer(from_fn_with_state(
            state.clone(),
            ratelimit::rate_limit_middleware,
        ));

    let app = Router::new()
        .route("/healthz", get(proxy::health_handler))
        .route("/api/ws", get(ws::ws_handler))
        .route("/api/display/ws", get(ws::display_ws_handler))
        .merge(protected)
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let listener = match TcpListener::bind(listen).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("hermes-gateway: cannot bind {listen}: {e}");
            std::process::exit(1);
        }
    };
    tracing::info!("hermes-gateway listening on {listen}, forwarding to {origin}");

    if let Err(e) = axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
            tracing::info!("shutdown signal received");
        })
        .await
    {
        eprintln!("hermes-gateway: server error: {e}");
        std::process::exit(1);
    }
}
