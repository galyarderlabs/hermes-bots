//! SQLite device store for QR pairing: pair codes, devices, server keys.
//!
//! One file, one connection, guarded by a std Mutex. All methods are
//! synchronous and short; handlers call them without holding the lock
//! across awaits. Secrets at rest: pair codes and device tokens are
//! stored SHA-256-hashed, never plaintext. The server private keys live
//! in this file too — it must stay on the host (mode 0600 on Unix),
//! next to the other host-local secrets (HERMES_DEVICE_TOKEN,
//! HERMES_HOST_BEARER). Losing the server keys means every device must
//! re-pair; the store never regenerates them silently.

use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

pub const PAIR_CODE_TTL_SECS: i64 = 600;
pub const PAIR_CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTVWXYZ";
const DEFAULT_STORE_PATH: &str = "gbots-store.db";

#[derive(Debug, Clone)]
pub struct ServerKeys {
    // Retained, not read in v1: the persistent server identity. Only
    // the public half is published (fingerprint), but regenerating the
    // secret would invalidate every paired fingerprint, so it stays in
    // the store and in this struct for future signed responses.
    #[allow(dead_code)]
    pub identity_sk: [u8; 32],
    pub identity_pk: [u8; 32],
    pub sealing_sk: [u8; 32],
    pub sealing_pk: [u8; 32],
}

#[derive(Debug, Clone)]
pub struct DeviceRow {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub role: String,
    pub created_at: i64,
    pub last_seen: i64,
}

#[derive(Clone)]
pub struct PairStore {
    conn: Arc<Mutex<Connection>>,
}

pub fn store_path_from_env() -> String {
    std::env::var("GBOTS_STORE_PATH")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_STORE_PATH.to_string())
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn hash_secret(value: &str) -> String {
    let mut h = Sha256::new();
    h.update(value.as_bytes());
    hex::encode(h.finalize())
}

pub fn hash_bytes(value: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(value);
    hex::encode(h.finalize())
}

impl PairStore {
    pub fn open(path: &str) -> Result<PairStore, String> {
        let conn =
            Connection::open(path).map_err(|e| format!("cannot open device store {path}: {e}"))?;
        // The store holds device tokens and keys: enforce 0600 on every
        // open, not only on creation — a pre-existing file must not keep
        // looser permissions from an earlier umask or copy.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        }
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS pair_codes (
                code_hash TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                used INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS devices (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                platform TEXT NOT NULL,
                token_hash TEXT NOT NULL,
                sign_key TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'owner',
                created_at INTEGER NOT NULL,
                last_seen INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS server_keys (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                identity_sk BLOB NOT NULL,
                sealing_sk BLOB NOT NULL
            );",
        )
        .map_err(|e| format!("cannot init device store {path}: {e}"))?;
        Ok(PairStore {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Server identity + sealing keys, generated once on first run and
    /// then stable. Never regenerates while a row exists.
    pub fn server_keys(&self) -> Result<ServerKeys, String> {
        let conn = self.lock();
        let row: Option<(Vec<u8>, Vec<u8>)> = conn
            .query_row(
                "SELECT identity_sk, sealing_sk FROM server_keys WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| format!("device store read failed: {e}"))?;
        let (identity_sk, sealing_sk) = match row {
            Some((isk, ssk)) => (
                isk.try_into()
                    .map_err(|_| "corrupt identity key in store".to_string())?,
                ssk.try_into()
                    .map_err(|_| "corrupt sealing key in store".to_string())?,
            ),
            None => {
                let isk: [u8; 32] = rand::random();
                let ssk: [u8; 32] = rand::random();
                conn.execute(
                    "INSERT INTO server_keys (id, identity_sk, sealing_sk) VALUES (1, ?, ?)",
                    params![isk.to_vec(), ssk.to_vec()],
                )
                .map_err(|e| format!("device store write failed: {e}"))?;
                (isk, ssk)
            }
        };
        let identity_pk = ed25519_dalek::SigningKey::from_bytes(&identity_sk)
            .verifying_key()
            .to_bytes();
        let sealing_pk =
            x25519_dalek::PublicKey::from(&x25519_dalek::StaticSecret::from(sealing_sk)).to_bytes();
        Ok(ServerKeys {
            identity_sk,
            identity_pk,
            sealing_sk,
            sealing_pk,
        })
    }

    pub fn fingerprint_hex(&self) -> Result<String, String> {
        let keys = self.server_keys()?;
        Ok(hash_bytes(&keys.identity_pk))
    }

    /// Create a one-time pair code. Retries on the (negligible) chance
    /// of a hash collision with an existing live code.
    pub fn create_pair_code(&self) -> Result<String, String> {
        let conn = self.lock();
        for _ in 0..5 {
            let code: String = (0..8)
                .map(|_| {
                    let b: u8 = rand::random();
                    PAIR_CODE_ALPHABET[(b % PAIR_CODE_ALPHABET.len() as u8) as usize] as char
                })
                .collect();
            let now = now_secs();
            match conn.execute(
                "INSERT INTO pair_codes (code_hash, created_at, expires_at, used) VALUES (?, ?, ?, 0)",
                params![hash_secret(&code), now, now + PAIR_CODE_TTL_SECS],
            ) {
                Ok(_) => return Ok(code),
                Err(e) => {
                    // PRIMARY KEY collision on code_hash: regenerate.
                    if e.to_string().contains("UNIQUE constraint") {
                        continue;
                    }
                    return Err(format!("device store write failed: {e}"));
                }
            }
        }
        Err("could not generate a fresh pair code".to_string())
    }

    /// Atomically redeem a code: returns its role on success, None when
    /// the code is unknown, expired, or already used. Expired and used
    /// rows are purged first. The UPDATE … WHERE used = 0 plus the
    /// changed-row check is what makes redemption single-use even if
    /// two processes share the file.
    pub fn redeem_pair_code(&self, code: &str) -> Result<Option<String>, String> {
        let normalized = code.trim().to_ascii_uppercase();
        let now = now_secs();
        let conn = self.lock();
        conn.execute(
            "DELETE FROM pair_codes WHERE expires_at < ? OR used = 1",
            params![now],
        )
        .map_err(|e| format!("device store write failed: {e}"))?;
        // v1: every device is owner; the role lives on the device
        // record, not on the code, so the code row carries no role.
        let found: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM pair_codes WHERE code_hash = ? AND used = 0 AND expires_at >= ?",
                params![hash_secret(&normalized), now],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("device store read failed: {e}"))?;
        if found.is_none() {
            return Ok(None);
        }
        let role = "owner".to_string();
        let changed = conn
            .execute(
                "UPDATE pair_codes SET used = 1 WHERE code_hash = ? AND used = 0",
                params![hash_secret(&normalized)],
            )
            .map_err(|e| format!("device store write failed: {e}"))?;
        if changed == 1 {
            Ok(Some(role))
        } else {
            Ok(None)
        }
    }

    pub fn add_device(
        &self,
        name: &str,
        platform: &str,
        token: &str,
        sign_key: &str,
        role: &str,
    ) -> Result<String, String> {
        let id = hex::encode(rand::random::<[u8; 16]>());
        let now = now_secs();
        let conn = self.lock();
        conn.execute(
            "INSERT INTO devices (id, name, platform, token_hash, sign_key, role, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![id, name, platform, hash_secret(token), sign_key, role, now, now],
        )
        .map_err(|e| format!("device store write failed: {e}"))?;
        Ok(id)
    }

    pub fn verify_device_token(&self, token: &str) -> Result<Option<String>, String> {
        let conn = self.lock();
        let row: Option<String> = conn
            .query_row(
                "SELECT id FROM devices WHERE token_hash = ?",
                params![hash_secret(token)],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("device store read failed: {e}"))?;
        Ok(row)
    }

    pub fn list_devices(&self) -> Result<Vec<DeviceRow>, String> {
        let conn = self.lock();
        let mut stmt = conn
            .prepare("SELECT id, name, platform, role, created_at, last_seen FROM devices ORDER BY created_at")
            .map_err(|e| format!("device store read failed: {e}"))?;
        let rows = stmt
            .query_map([], |r| {
                Ok(DeviceRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    platform: r.get(2)?,
                    role: r.get(3)?,
                    created_at: r.get(4)?,
                    last_seen: r.get(5)?,
                })
            })
            .map_err(|e| format!("device store read failed: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("device store read failed: {e}"))?);
        }
        Ok(out)
    }

    pub fn remove_device(&self, id: &str) -> Result<bool, String> {
        let conn = self.lock();
        let changed = conn
            .execute("DELETE FROM devices WHERE id = ?", params![id])
            .map_err(|e| format!("device store write failed: {e}"))?;
        Ok(changed == 1)
    }

    pub fn device_count(&self) -> Result<usize, String> {
        let conn = self.lock();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM devices", [], |r| r.get(0))
            .map_err(|e| format!("device store read failed: {e}"))?;
        Ok(count as usize)
    }

    pub fn touch_device(&self, id: &str) -> Result<(), String> {
        let conn = self.lock();
        conn.execute(
            "UPDATE devices SET last_seen = ? WHERE id = ?",
            params![now_secs(), id],
        )
        .map_err(|e| format!("device store write failed: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str) -> (PairStore, std::path::PathBuf) {
        let dir = std::path::Path::new("target/test-dbs");
        let _ = std::fs::create_dir_all(dir);
        let path = dir.join(format!("{name}-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        (PairStore::open(path.to_str().unwrap()).unwrap(), path)
    }

    #[test]
    fn code_redeems_exactly_once() {
        let (store, _path) = temp_store("redeem");
        let code = store.create_pair_code().unwrap();
        assert_eq!(
            store.redeem_pair_code(&code).unwrap(),
            Some("owner".to_string())
        );
        assert_eq!(store.redeem_pair_code(&code).unwrap(), None);
        assert_eq!(store.redeem_pair_code("ZZZZZZZZ").unwrap(), None);
        // Codes normalize: lowercase input redeems an uppercase code.
        let code2 = store.create_pair_code().unwrap();
        assert_eq!(
            store.redeem_pair_code(&code2.to_ascii_lowercase()).unwrap(),
            Some("owner".to_string())
        );
    }

    #[test]
    fn expired_code_does_not_redeem() {
        let (store, path) = temp_store("expired");
        let code = store.create_pair_code().unwrap();
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute(
                "UPDATE pair_codes SET expires_at = 0 WHERE code_hash = ?",
                params![hash_secret(&code)],
            )
            .unwrap();
        }
        assert_eq!(store.redeem_pair_code(&code).unwrap(), None);
    }

    #[test]
    fn device_token_roundtrip_and_revoke() {
        let (store, _path) = temp_store("device");
        assert_eq!(store.device_count().unwrap(), 0);
        let id = store
            .add_device("Pixel", "android", "tok-1", "sign-key", "owner")
            .unwrap();
        assert_eq!(store.device_count().unwrap(), 1);
        assert_eq!(
            store.verify_device_token("tok-1").unwrap(),
            Some(id.clone())
        );
        assert_eq!(store.verify_device_token("tok-2").unwrap(), None);
        assert!(store.remove_device(&id).unwrap());
        assert!(!store.remove_device(&id).unwrap());
        assert_eq!(store.verify_device_token("tok-1").unwrap(), None);
    }

    #[test]
    fn server_keys_stable_and_fingerprint_matches() {
        let (store, _path) = temp_store("keys");
        let first = store.server_keys().unwrap();
        let second = store.server_keys().unwrap();
        assert_eq!(first.identity_pk, second.identity_pk);
        assert_eq!(first.sealing_pk, second.sealing_pk);
        assert_eq!(
            store.fingerprint_hex().unwrap(),
            hash_bytes(&first.identity_pk)
        );
        assert_eq!(store.fingerprint_hex().unwrap().len(), 64);
    }
}
