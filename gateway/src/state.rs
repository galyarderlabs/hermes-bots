//! Shared application state: config, HTTP client, single-use tickets,
//! live-session registry (for push suppression), and revocation flag.
//!
//! Nothing in this module stores LLM provider credentials, message content,
//! or tokens in a readable-back form. Tickets are random values kept only
//! until first use or expiry.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::Mutex;

use crate::config::Config;
use crate::push::PushConfig;
use crate::ratelimit::RateState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TicketPurpose {
    /// Ticket for the proxy's own `/api/ws` (mobile socket).
    Ws,
    /// Ticket for the `/api/display/ws` RFB bridge stub.
    Display,
}

#[derive(Debug, Clone)]
pub struct Ticket {
    pub purpose: TicketPurpose,
    /// Viewer id bound to a display ticket; None for WS tickets.
    pub viewer_id: Option<String>,
    pub expires_at: Instant,
}

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub http: reqwest::Client,
    pub tickets: Arc<Mutex<HashMap<String, Ticket>>>,
    /// Live session ids per mobile connection, reference-counted so two
    /// connections sharing a session cannot clear each other's entry.
    /// Used ONLY to suppress push while a socket is live. No content.
    pub live_sessions: Arc<Mutex<HashMap<String, usize>>>,
    /// Display-bridge lease holder: the single viewer_id currently
    /// holding a display-ws connection, if any.
    pub display_holder: Arc<Mutex<Option<String>>>,
    /// In-memory device-token revocation. Restart restores the env token,
    /// so permanent revocation means rotating HERMES_DEVICE_TOKEN.
    pub revoked: Arc<Mutex<bool>>,
    pub rate: Arc<RateState>,
    pub push: PushConfig,
}

impl AppState {
    pub fn new(config: Config, push: PushConfig) -> AppState {
        AppState {
            rate: Arc::new(RateState::new(config.rate_per_min, config.rate_burst)),
            config: Arc::new(config),
            http: reqwest::Client::new(),
            tickets: Arc::new(Mutex::new(HashMap::new())),
            live_sessions: Arc::new(Mutex::new(HashMap::new())),
            display_holder: Arc::new(Mutex::new(None)),
            revoked: Arc::new(Mutex::new(false)),
            push,
        }
    }

    pub async fn mint_ticket(
        &self,
        purpose: TicketPurpose,
        viewer_id: Option<String>,
    ) -> (String, u64) {
        let bytes: [u8; 32] = rand::random();
        let ticket = hex::encode(bytes);
        let ttl = self.config.ticket_ttl_secs;
        let mut map = self.tickets.lock().await;
        map.insert(
            ticket.clone(),
            Ticket {
                purpose,
                viewer_id,
                expires_at: Instant::now() + std::time::Duration::from_secs(ttl),
            },
        );
        (ticket, ttl)
    }

    /// Consume a ticket: single-use, purpose-checked, expiry-checked.
    /// Returns the bound viewer_id on success.
    pub async fn consume_ticket(
        &self,
        value: &str,
        purpose: TicketPurpose,
    ) -> Option<Option<String>> {
        let mut map = self.tickets.lock().await;
        let ticket = map.remove(value)?;
        if ticket.purpose != purpose || ticket.expires_at < Instant::now() {
            return None;
        }
        Some(ticket.viewer_id)
    }

    pub async fn revoke_all(&self) {
        *self.revoked.lock().await = true;
        self.tickets.lock().await.clear();
    }

    pub async fn is_revoked(&self) -> bool {
        *self.revoked.lock().await
    }

    pub async fn mark_one(&self, session: &str) {
        let mut map = self.live_sessions.lock().await;
        *map.entry(session.to_string()).or_insert(0) += 1;
    }

    pub async fn unmark_live(&self, sessions: &HashSet<String>) {
        let mut map = self.live_sessions.lock().await;
        for s in sessions {
            if let Some(count) = map.get_mut(s) {
                *count = count.saturating_sub(1);
                if *count == 0 {
                    map.remove(s);
                }
            }
        }
    }

    pub async fn is_live(&self, session_id: &str) -> bool {
        self.live_sessions.lock().await.contains_key(session_id)
    }
}
