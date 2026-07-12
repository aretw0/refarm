//! Respawn supervisor — reinstantiate a plugin whose last runner tore down on an
//! epoch trap (a cancelled or timed-out turn).
//!
//! After such a trap the wasmtime store is unwound mid-execution and cannot be
//! re-entered, so the runner exits (`spawn_plugin_store_runner`'s `break`). For a
//! single-runner plugin — the default, e.g. the agent — that would leave the plugin
//! loaded but DEAD (dispatch delivered, nothing executes) until a full runtime
//! restart. The primary runner instead sends its `plugin_id` on the respawn channel;
//! this supervisor reloads a FRESH instance by the plugin's recorded path and
//! re-registers it, so a cancelled turn costs one sub-second reinstantiation.
//!
//! The heavy lifting reuses the existing boot machinery — `TractorNative::load_plugin`
//! (the same call the self-dispatch spawner uses to make a fresh instance) plus
//! `register_for_events` (upserts the channel, cancel flag, registry profile, router
//! subscriptions, and the default-responder election under the same id). This module
//! owns only the SUPERVISION policy: what to respawn, and the anti-hot-loop cooldown.

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Minimum wall-clock gap between respawns of the SAME plugin. A plugin that traps
/// on every turn would otherwise pin a core respawn-looping; this bounds it to at
/// most one reinstantiation per window, after which a genuinely wedged plugin settles
/// into "dead until restart" rather than a hot loop.
pub(crate) const RESPAWN_COOLDOWN: Duration = Duration::from_secs(10);

/// Tracks the last respawn time per plugin so the supervisor can enforce the cooldown.
/// Not thread-shared — owned by the single supervisor task.
#[derive(Default)]
pub(crate) struct RespawnCooldown {
    last: HashMap<String, Instant>,
}

impl RespawnCooldown {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Decide whether `plugin_id` may respawn at time `now`. Returns true (and records
    /// `now` as its last respawn) when the plugin has never respawned or its last
    /// respawn is at least `RESPAWN_COOLDOWN` ago; false (a no-op) when it is still
    /// inside the cooldown window. PURE apart from the internal bookkeeping, so the
    /// decision is unit-testable with a synthetic clock.
    pub(crate) fn allow(&mut self, plugin_id: &str, now: Instant) -> bool {
        if let Some(prev) = self.last.get(plugin_id) {
            if now.duration_since(*prev) < RESPAWN_COOLDOWN {
                return false;
            }
        }
        self.last.insert(plugin_id.to_string(), now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_respawn_of_a_plugin_is_allowed() {
        let mut cd = RespawnCooldown::new();
        assert!(cd.allow("agent", Instant::now()));
    }

    #[test]
    fn a_second_respawn_within_the_cooldown_is_denied() {
        let mut cd = RespawnCooldown::new();
        let t0 = Instant::now();
        assert!(cd.allow("agent", t0));
        // 1s later — well inside the 10s window.
        assert!(!cd.allow("agent", t0 + Duration::from_secs(1)));
    }

    #[test]
    fn a_respawn_after_the_cooldown_is_allowed_again() {
        let mut cd = RespawnCooldown::new();
        let t0 = Instant::now();
        assert!(cd.allow("agent", t0));
        // Exactly at the boundary is allowed (>= cooldown).
        assert!(cd.allow("agent", t0 + RESPAWN_COOLDOWN));
    }

    #[test]
    fn cooldown_is_per_plugin_independent() {
        let mut cd = RespawnCooldown::new();
        let t0 = Instant::now();
        assert!(cd.allow("agent", t0));
        // A DIFFERENT plugin is unaffected by agent's cooldown.
        assert!(cd.allow("delegate", t0 + Duration::from_secs(1)));
        // ...but agent is still cooling down.
        assert!(!cd.allow("agent", t0 + Duration::from_secs(2)));
    }

    #[test]
    fn the_boundary_updates_the_last_time_so_the_window_slides() {
        let mut cd = RespawnCooldown::new();
        let t0 = Instant::now();
        assert!(cd.allow("agent", t0));
        let t1 = t0 + RESPAWN_COOLDOWN; // allowed, records t1
        assert!(cd.allow("agent", t1));
        // Now measured from t1, not t0: 1s after t1 is denied.
        assert!(!cd.allow("agent", t1 + Duration::from_secs(1)));
    }
}
