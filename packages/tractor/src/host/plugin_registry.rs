//! The shared plugin registry — the source of truth for what plugins are LOADED
//! and what capabilities each declares (`provides` / `subscribes`).
//!
//! WHY THIS EXISTS. Two host features need to reason about OTHER loaded plugins
//! from inside a plugin's host-call, and both were blocked by the same missing
//! piece:
//!   - `get_plugin_api` (tractor-bridge) was a STUB: "plugin-to-plugin API
//!     discovery needs a shared registry (api-name → plugin-id map) which is not
//!     built yet."
//!   - the AGENT LEG (#6, `capability-tools`): the agent guest must LIST the
//!     registry's dispatchable verbs as tools and INVOKE one — which means
//!     enumerating every loaded plugin's `provides` + `subscribes`.
//!
//! The event router (`EventRouter`) already maps event → subscriber-ids, but it
//! does not carry a plugin's `provides` (which verbs it serves). This registry
//! adds that, populated at the SAME point the router is (`run_plugin`), so a
//! plugin's full capability profile is reachable by id from any host-call.
//!
//! SECURITY COMPOSES FOR FREE. The registry only ever holds LOADED plugins. A
//! revoked / untrusted plugin never loads (the Strict load gate bails), so it is
//! never inserted here — its verbs are not listable and not invokable. Surfacing a
//! plugin's verb to the agent therefore widens REACH (the agent can call it), never
//! POWER (a plugin absent from the registry is invisible), exactly as the #1 adapter
//! guarantees on the CLI/REPL/HTTP surfaces.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

/// One loaded plugin's declared capability profile — the manifest's routing lists,
/// captured at load. `provides` names the verbs/APIs it serves (`<key>:<verb>`,
/// plus any `providesApi` entries); `subscribes` names the events it receives
/// (`<key>:dispatch` for a dispatchable plugin).
#[derive(Debug, Clone, Default)]
pub struct PluginCapabilityProfile {
    pub provides: Vec<String>,
    pub subscribes: Vec<String>,
}

/// A dispatchable verb surfaced by a loaded plugin: the plugin's id, its routing
/// KEY (the last path segment — `@scope/vault` → `vault`), and the verb name.
/// This is exactly the shape the #1 adapter derives on the TS side, computed here
/// on the host so the agent leg and `get_plugin_api` share one derivation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DispatchableVerb {
    pub plugin_id: String,
    pub plugin_key: String,
    pub verb: String,
}

/// The shared registry: `plugin-id → capability profile`, Arc-shared so the runtime
/// (which OWNS the load lifecycle) populates it and every plugin's host bindings can
/// read it. Cloning shares the same inner map (like `EventRouter`).
#[derive(Clone, Default)]
pub struct PluginRegistry {
    inner: Arc<RwLock<HashMap<String, PluginCapabilityProfile>>>,
}

/// Parse a `<key>:<verb>` provides entry into (key, verb). Returns None for a
/// non-verb entry (no colon, an empty side, or the reserved `dispatch` routing
/// key). Mirrors the #1 adapter's `parseProvidedVerb`.
fn parse_provided_verb(entry: &str) -> Option<(&str, &str)> {
    let idx = entry.find(':')?;
    if idx == 0 || idx == entry.len() - 1 {
        return None;
    }
    let key = &entry[..idx];
    let verb = &entry[idx + 1..];
    if verb == "dispatch" {
        return None; // the routing key, not a user verb
    }
    Some((key, verb))
}

impl PluginRegistry {
    /// Record (upsert) a loaded plugin's capability profile. Called at load, beside
    /// the `plugin_channels` insert + `event_router.subscribe` calls.
    pub fn register(&self, plugin_id: &str, provides: Vec<String>, subscribes: Vec<String>) {
        self.inner
            .write()
            .expect("plugin_registry poisoned")
            .insert(
                plugin_id.to_string(),
                PluginCapabilityProfile { provides, subscribes },
            );
    }

    /// Remove a plugin on unload/teardown (mirrors `EventRouter::unsubscribe_all`),
    /// so its verbs stop being listable/invokable the moment it is gone.
    pub fn unregister(&self, plugin_id: &str) {
        self.inner
            .write()
            .expect("plugin_registry poisoned")
            .remove(plugin_id);
    }

    /// The capability profile of a loaded plugin, if present.
    pub fn profile(&self, plugin_id: &str) -> Option<PluginCapabilityProfile> {
        self.inner
            .read()
            .expect("plugin_registry poisoned")
            .get(plugin_id)
            .cloned()
    }

    /// Every dispatchable verb across all loaded plugins: a `<key>:<verb>` in a
    /// plugin's `provides`, GUARDED by `<key>:dispatch` in the SAME plugin's
    /// `subscribes` (only a plugin that receives its own dispatch events can serve
    /// a dispatched verb). This is the exact eligibility rule the #1 adapter uses,
    /// so a verb is surfaced to the agent iff it is surfaced to CLI/REPL/HTTP.
    /// Deterministic order: plugins by id, verbs in declaration order.
    pub fn dispatchable_verbs(&self) -> Vec<DispatchableVerb> {
        let guard = self.inner.read().expect("plugin_registry poisoned");
        let mut ids: Vec<&String> = guard.keys().collect();
        ids.sort();

        let mut out = Vec::new();
        for id in ids {
            let profile = &guard[id];
            let subscribes: std::collections::HashSet<&String> =
                profile.subscribes.iter().collect();
            for entry in &profile.provides {
                let Some((key, verb)) = parse_provided_verb(entry) else {
                    continue;
                };
                if !subscribes.contains(&format!("{key}:dispatch")) {
                    continue;
                }
                out.push(DispatchableVerb {
                    plugin_id: id.clone(),
                    plugin_key: key.to_string(),
                    verb: verb.to_string(),
                });
            }
        }
        out
    }

    /// Find the id of a loaded plugin that provides a named API (the `providesApi`
    /// convention `api:<name>` in `provides`). Unblocks `get_plugin_api`, which was
    /// a STUB waiting for exactly this registry. Returns the first match in id order
    /// for determinism.
    pub fn plugin_providing_api(&self, api_name: &str) -> Option<String> {
        let needle = format!("api:{api_name}");
        let guard = self.inner.read().expect("plugin_registry poisoned");
        let mut ids: Vec<&String> = guard.keys().collect();
        ids.sort();
        for id in ids {
            if guard[id].provides.iter().any(|p| p == &needle) {
                return Some(id.clone());
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reg() -> PluginRegistry {
        let r = PluginRegistry::default();
        // A dispatchable plugin: provides vault:store guarded by vault:dispatch.
        r.register(
            "@acme/vault",
            vec!["vault:store".into(), "vault:read".into(), "vault:dispatch".into()],
            vec!["vault:dispatch".into()],
        );
        // A plugin that provides a verb but does NOT subscribe to its dispatch —
        // not dispatchable, must be excluded.
        r.register(
            "orphan",
            vec!["orphan:go".into()],
            vec!["something:else".into()],
        );
        r
    }

    #[test]
    fn dispatchable_verbs_applies_the_dispatch_guard() {
        let verbs = reg().dispatchable_verbs();
        // vault's two verbs surface (guarded by vault:dispatch); the routing key
        // vault:dispatch itself is NOT a verb; orphan:go is excluded (no guard).
        assert_eq!(
            verbs,
            vec![
                DispatchableVerb {
                    plugin_id: "@acme/vault".into(),
                    plugin_key: "vault".into(),
                    verb: "store".into(),
                },
                DispatchableVerb {
                    plugin_id: "@acme/vault".into(),
                    plugin_key: "vault".into(),
                    verb: "read".into(),
                },
            ]
        );
    }

    #[test]
    fn unregister_removes_a_plugins_verbs() {
        let r = reg();
        r.unregister("@acme/vault");
        assert!(r.dispatchable_verbs().is_empty());
        assert!(r.profile("@acme/vault").is_none());
    }

    #[test]
    fn parse_provided_verb_rejects_non_verbs() {
        assert_eq!(parse_provided_verb("vault:store"), Some(("vault", "store")));
        assert_eq!(parse_provided_verb("vault:dispatch"), None); // routing key
        assert_eq!(parse_provided_verb("nocolon"), None);
        assert_eq!(parse_provided_verb(":leading"), None);
        assert_eq!(parse_provided_verb("trailing:"), None);
    }

    #[test]
    fn plugin_providing_api_matches_the_api_convention() {
        let r = PluginRegistry::default();
        r.register("provider", vec!["api:embeddings".into()], vec![]);
        r.register("other", vec!["other:verb".into()], vec![]);
        assert_eq!(
            r.plugin_providing_api("embeddings"),
            Some("provider".to_string())
        );
        assert_eq!(r.plugin_providing_api("missing"), None);
    }
}
