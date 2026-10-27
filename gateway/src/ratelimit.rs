//! Per-device token-bucket rate limiting for REST (and a per-connection
//! bucket helper for the WS pump).
//!
//! Keys are hashed before storage: the bucket map never holds a raw
//! token, and nothing here is logged. v1 deployments have one device
//! token, so the keyed buckets are effectively per-device; multi-device
//! deployments get one bucket per distinct credential automatically.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::time::Instant;

use axum::extract::{Request, State};
use axum::http::header::AUTHORIZATION;
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Json, Response};
use serde::Serialize;

use crate::state::AppState;

struct Bucket {
    tokens: f64,
    last: Instant,
}

pub struct RateState {
    buckets: Mutex<HashMap<u64, Bucket>>,
    per_min: u32,
    burst: u32,
}

impl RateState {
    pub fn new(per_min: u32, burst: u32) -> RateState {
        RateState {
            buckets: Mutex::new(HashMap::new()),
            per_min: per_min.max(1),
            burst: burst.max(1),
        }
    }

    /// Returns true when one request is allowed for `key`.
    pub fn check(&self, key: &str) -> bool {
        let mut hasher = DefaultHasher::new();
        key.hash(&mut hasher);
        let id = hasher.finish();

        let mut buckets = self.buckets.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        let bucket = buckets.entry(id).or_insert(Bucket {
            tokens: self.burst as f64,
            last: now,
        });
        let elapsed = now.duration_since(bucket.last).as_secs_f64();
        bucket.tokens =
            (bucket.tokens + elapsed * (self.per_min as f64 / 60.0)).min(self.burst as f64);
        bucket.last = now;
        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

/// Token bucket for a single WS connection (burst + steady refill).
/// The WS pump closes the connection on exhaustion rather than silently
/// dropping lines, so the client can reconnect with backoff.
pub struct ConnectionBucket {
    tokens: f64,
    last: Instant,
    refill_per_sec: f64,
    burst: f64,
}

impl ConnectionBucket {
    pub fn new(burst: f64, refill_per_sec: f64) -> ConnectionBucket {
        ConnectionBucket {
            tokens: burst,
            last: Instant::now(),
            refill_per_sec,
            burst,
        }
    }

    pub fn check(&mut self) -> bool {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.refill_per_sec).min(self.burst);
        self.last = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

#[derive(Serialize)]
struct ErrorBody {
    error: &'static str,
}

/// Axum middleware for the protected router. Keys on the presented
/// credential (hashed); anonymous requests share one bucket.
pub async fn rate_limit_middleware(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    let key = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("anonymous")
        .to_string();
    if state.rate.check(&key) {
        next.run(req).await
    } else {
        tracing::warn!("rate limit exceeded for a device credential");
        let mut headers = HeaderMap::new();
        headers.insert("retry-after", "60".parse().unwrap());
        (
            StatusCode::TOO_MANY_REQUESTS,
            headers,
            Json(ErrorBody {
                error: "rate_limited",
            }),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn burst_allows_then_denies_without_refill() {
        let state = RateState::new(60, 3);
        assert!(state.check("device-a"));
        assert!(state.check("device-a"));
        assert!(state.check("device-a"));
        assert!(!state.check("device-a"));
        // A different credential gets its own bucket.
        assert!(state.check("device-b"));
    }
}
