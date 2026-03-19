//! Trust Manager — plugin trust grants and execution profiles.
//!
//! Mirrors `trust-manager.ts` from packages/tractor/src/lib/.

use std::collections::HashMap;

/// Controls how nodes are signed and verified.
///
/// Mirrors `SecurityMode` from packages/tractor/src/lib/types.ts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecurityMode {
    /// All nodes are signed; signatures are verified on read. Default.
    Strict,
    /// Nodes are signed but verification failures are warnings, not errors.
    Permissive,
    /// No signing or verification. For dev / air-gapped / test scenarios.
    None,
}

/// Controls which WASI capabilities a plugin receives.
///
/// Mirrors `ExecutionProfile` from packages/tractor/src/lib/trust-manager.ts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecutionProfile {
    /// Sandbox enforced: origin allowlist, capability checks. Default.
    Strict,
    /// Elevated trust: all HTTP origins allowed, faster execution path.
    TrustedFast,
}

/// A time-bounded trust grant for a specific plugin + WASM hash pair.
///
/// Mirrors `PluginTrustGrant` from packages/tractor/src/lib/trust-manager.ts.
#[derive(Debug, Clone)]
pub struct TrustGrant {
    pub plugin_id: String,
    /// SHA-256 hex digest of the .wasm binary (W3C SRI compatible)
    pub wasm_hash: String,
    /// Unix timestamp (ms) when the grant was created
    pub granted_at: u64,
    /// Unix timestamp (ms) when the grant expires (None = permanent)
    pub expires_at: Option<u64>,
}

impl TrustGrant {
    fn is_expired(&self, now_ms: u64) -> bool {
        self.expires_at.map_or(false, |exp| now_ms >= exp)
    }
}

/// Manages plugin trust grants in memory.
///
/// Mirrors `TrustManager` from packages/tractor/src/lib/trust-manager.ts.
#[derive(Debug, Clone)]
pub struct TrustManager {
    /// Key: "{plugin_id}::{wasm_hash}"
    grants: HashMap<String, TrustGrant>,
    /// Security mode controlling plugin loading enforcement.
    pub(crate) security_mode: SecurityMode,
}

impl Default for TrustManager {
    fn default() -> Self {
        Self { grants: HashMap::new(), security_mode: SecurityMode::None }
    }
}

impl TrustManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a TrustManager with the given security mode.
    ///
    /// `SecurityMode::Strict` requires an explicit trust grant before a plugin
    /// can be loaded by `PluginHost`.
    pub fn with_security_mode(mode: SecurityMode) -> Self {
        Self { grants: HashMap::new(), security_mode: mode }
    }

    /// Return the current security mode.
    pub fn security_mode(&self) -> &SecurityMode {
        &self.security_mode
    }

    fn grant_key(plugin_id: &str, wasm_hash: &str) -> String {
        format!("{plugin_id}::{wasm_hash}")
    }

    fn now_ms() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }

    /// Check if a valid (non-expired) trust grant exists for this plugin.
    pub fn has_valid_grant(&self, plugin_id: &str, wasm_hash: Option<&str>) -> bool {
        let now = Self::now_ms();
        if let Some(hash) = wasm_hash {
            let key = Self::grant_key(plugin_id, hash);
            self.grants
                .get(&key)
                .map_or(false, |g| !g.is_expired(now))
        } else {
            // Any valid grant for this plugin
            self.grants.values().any(|g| {
                g.plugin_id == plugin_id && !g.is_expired(now)
            })
        }
    }

    /// Grant trust to a plugin. `lease_ms = None` means permanent.
    pub fn grant(
        &mut self,
        plugin_id: impl Into<String>,
        wasm_hash: impl Into<String>,
        lease_ms: Option<u64>,
    ) -> TrustGrant {
        let plugin_id = plugin_id.into();
        let wasm_hash = wasm_hash.into();
        let granted_at = Self::now_ms();
        let expires_at = lease_ms.map(|ms| granted_at + ms);
        let key = Self::grant_key(&plugin_id, &wasm_hash);
        let grant = TrustGrant { plugin_id, wasm_hash, granted_at, expires_at };
        self.grants.insert(key, grant.clone());
        grant
    }

    /// Revoke trust. Pass `wasm_hash = None` to revoke all grants for the plugin.
    pub fn revoke(&mut self, plugin_id: &str, wasm_hash: Option<&str>) {
        if let Some(hash) = wasm_hash {
            let key = Self::grant_key(plugin_id, hash);
            self.grants.remove(&key);
        } else {
            self.grants.retain(|_, g| g.plugin_id != plugin_id);
        }
    }

    /// Resolve execution profile for a plugin.
    /// If manifest requests TrustedFast but no valid grant exists → downgrade to Strict.
    pub fn resolve_profile(
        &self,
        plugin_id: &str,
        wasm_hash: Option<&str>,
        requested: &ExecutionProfile,
    ) -> ExecutionProfile {
        if *requested == ExecutionProfile::TrustedFast
            && self.has_valid_grant(plugin_id, wasm_hash)
        {
            ExecutionProfile::TrustedFast
        } else {
            ExecutionProfile::Strict
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grant_and_check() {
        let mut tm = TrustManager::new();
        tm.grant("my-plugin", "abc123", None);
        assert!(tm.has_valid_grant("my-plugin", Some("abc123")));
        assert!(tm.has_valid_grant("my-plugin", None));
        assert!(!tm.has_valid_grant("other-plugin", None));
    }

    #[test]
    fn revoke_specific_hash() {
        let mut tm = TrustManager::new();
        tm.grant("p", "hash1", None);
        tm.grant("p", "hash2", None);
        tm.revoke("p", Some("hash1"));
        assert!(!tm.has_valid_grant("p", Some("hash1")));
        assert!(tm.has_valid_grant("p", Some("hash2")));
    }

    #[test]
    fn revoke_all() {
        let mut tm = TrustManager::new();
        tm.grant("p", "hash1", None);
        tm.grant("p", "hash2", None);
        tm.revoke("p", None);
        assert!(!tm.has_valid_grant("p", None));
    }

    #[test]
    fn expired_grant_is_invalid() {
        let mut tm = TrustManager::new();
        // Grant with 0ms lease → already expired
        tm.grant("p", "h", Some(0));
        // Sleep 1ms to ensure expiry
        std::thread::sleep(std::time::Duration::from_millis(1));
        assert!(!tm.has_valid_grant("p", Some("h")));
    }

    #[test]
    fn profile_downgrade_without_grant() {
        let tm = TrustManager::new();
        let profile = tm.resolve_profile("p", Some("h"), &ExecutionProfile::TrustedFast);
        assert_eq!(profile, ExecutionProfile::Strict);
    }

    #[test]
    fn profile_trusted_fast_with_grant() {
        let mut tm = TrustManager::new();
        tm.grant("p", "h", None);
        let profile = tm.resolve_profile("p", Some("h"), &ExecutionProfile::TrustedFast);
        assert_eq!(profile, ExecutionProfile::TrustedFast);
    }
}
