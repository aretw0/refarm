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
    /// Per-verb usage prose (`capabilities.verbDocs`), keyed by `<key>:<verb>`.
    /// When a verb has an entry, `list-tool-prompts` returns it instead of the
    /// host-synthesized boilerplate (promptSnippet Slice 2). Empty for plugins that
    /// declare none.
    pub verb_docs: std::collections::HashMap<String, String>,
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
    /// Plugin-authored usage prose for this verb (`verbDocs["<key>:<verb>"]`), if
    /// declared — the agent leg's `list-tool-prompts` returns it instead of the host
    /// boilerplate. `None` → host synthesizes generic guidance.
    pub doc: Option<String>,
}

/// The shared registry: `plugin-id → capability profile`, Arc-shared so the runtime
/// (which OWNS the load lifecycle) populates it and every plugin's host bindings can
/// read it. Cloning shares the same inner map (like `EventRouter`).
///
/// `requires_api` is kept in a SEPARATE map (not on the profile) deliberately: it's
/// consumed only by the post-load advisory reconciliation, never on the hot
/// list/invoke path, so keeping it off `PluginCapabilityProfile` leaves `register()`
/// — the hot-path populator — untouched.
#[derive(Clone, Default)]
pub struct PluginRegistry {
    inner: Arc<RwLock<HashMap<String, PluginCapabilityProfile>>>,
    requires_api: Arc<RwLock<HashMap<String, Vec<String>>>>,
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
    pub fn register(
        &self,
        plugin_id: &str,
        provides: Vec<String>,
        subscribes: Vec<String>,
        verb_docs: std::collections::HashMap<String, String>,
    ) {
        self.inner
            .write()
            .expect("plugin_registry poisoned")
            .insert(
                plugin_id.to_string(),
                PluginCapabilityProfile { provides, subscribes, verb_docs },
            );
    }

    /// Record the APIs a loaded plugin declares it REQUIRES (SPI consumer side), for
    /// the post-load advisory reconciliation. Separate from `register` so the hot
    /// path stays untouched; called at the same load point.
    pub fn record_requires_api(&self, plugin_id: &str, requires_api: Vec<String>) {
        if requires_api.is_empty() {
            return;
        }
        self.requires_api
            .write()
            .expect("plugin_registry requires_api poisoned")
            .insert(plugin_id.to_string(), requires_api);
    }

    /// The APIs declared-required across all loaded plugins that have NO loaded
    /// provider — advisory only (load-order-safe: called after a load batch, and a
    /// later-loaded provider clears the gap on the next check). Returns
    /// `(plugin_id, api_name)` pairs. The real enforcement is `get_plugin_api`
    /// failing `NotFound` at call time; this is boot-time operator surfacing.
    pub fn unmet_required_apis(&self) -> Vec<(String, String)> {
        let requires = self.requires_api.read().expect("plugin_registry requires_api poisoned");
        let mut ids: Vec<&String> = requires.keys().collect();
        ids.sort();
        let mut unmet = Vec::new();
        for id in ids {
            for api in &requires[id] {
                if self.plugin_providing_api(api).is_none() {
                    unmet.push((id.clone(), api.clone()));
                }
            }
        }
        unmet
    }

    /// Remove a plugin on unload/teardown (mirrors `EventRouter::unsubscribe_all`),
    /// so its verbs stop being listable/invokable the moment it is gone.
    pub fn unregister(&self, plugin_id: &str) {
        self.inner
            .write()
            .expect("plugin_registry poisoned")
            .remove(plugin_id);
        self.requires_api
            .write()
            .expect("plugin_registry requires_api poisoned")
            .remove(plugin_id);
    }

    /// The capability profile of a loaded plugin, if present. Kept but `#[cfg(test)]`-
    /// gated: there is no production caller YET. (promptSnippet Slice 2's verb-docs
    /// ride the FLAT `dispatchable_verbs()` iterator — a per-verb `doc` on
    /// `DispatchableVerb` — not a per-plugin `profile()` lookup, so it did NOT become
    /// this method's consumer.) The real first consumer is a future per-plugin
    /// introspection endpoint that returns one plugin's full profile by id. The
    /// read-shape is worth documenting, so this is gated rather than deleted.
    #[cfg(test)]
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
                    doc: profile.verb_docs.get(entry).cloned(),
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

    /// Register with no verb-docs — the common test case.
    fn register_plain(r: &PluginRegistry, id: &str, provides: Vec<String>, subscribes: Vec<String>) {
        r.register(id, provides, subscribes, std::collections::HashMap::new());
    }

    fn reg() -> PluginRegistry {
        let r = PluginRegistry::default();
        // A dispatchable plugin: provides vault:store guarded by vault:dispatch.
        register_plain(
            &r,
            "@acme/vault",
            vec!["vault:store".into(), "vault:read".into(), "vault:dispatch".into()],
            vec!["vault:dispatch".into()],
        );
        // A plugin that provides a verb but does NOT subscribe to its dispatch —
        // not dispatchable, must be excluded.
        register_plain(&r, "orphan", vec!["orphan:go".into()], vec!["something:else".into()]);
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
                    doc: None,
                },
                DispatchableVerb {
                    plugin_id: "@acme/vault".into(),
                    plugin_key: "vault".into(),
                    verb: "read".into(),
                    doc: None,
                },
            ]
        );
    }

    #[test]
    fn verb_docs_ride_the_dispatchable_verb_as_doc() {
        let r = PluginRegistry::default();
        let mut docs = std::collections::HashMap::new();
        docs.insert("vault:store".to_string(), "Store a note in the vault.".to_string());
        r.register(
            "vault",
            vec!["vault:store".into(), "vault:read".into(), "vault:dispatch".into()],
            vec!["vault:dispatch".into()],
            docs,
        );
        let verbs = r.dispatchable_verbs();
        // The verb WITH a doc carries it; the verb WITHOUT falls back to None (host
        // boilerplate at render time).
        let store = verbs.iter().find(|v| v.verb == "store").unwrap();
        assert_eq!(store.doc.as_deref(), Some("Store a note in the vault."));
        let read = verbs.iter().find(|v| v.verb == "read").unwrap();
        assert_eq!(read.doc, None);
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
        register_plain(&r, "provider", vec!["api:embeddings".into()], vec![]);
        register_plain(&r, "other", vec!["other:verb".into()], vec![]);
        assert_eq!(
            r.plugin_providing_api("embeddings"),
            Some("provider".to_string())
        );
        assert_eq!(r.plugin_providing_api("missing"), None);
    }

    #[test]
    fn unmet_required_apis_reports_only_gaps_and_clears_when_provider_loads() {
        let r = PluginRegistry::default();
        // A consumer requires QualityApi; no provider yet → unmet.
        register_plain(&r, "vault", vec!["vault:store".into()], vec![]);
        r.record_requires_api("vault", vec!["QualityApi".into()]);
        assert_eq!(
            r.unmet_required_apis(),
            vec![("vault".to_string(), "QualityApi".to_string())]
        );
        // Provider loads (folded `api:QualityApi` in its provides) → gap closes.
        register_plain(&r, "quality", vec!["api:QualityApi".into()], vec![]);
        assert!(r.unmet_required_apis().is_empty());
        // Unregister the provider → the gap reopens (advisory, order-immune).
        r.unregister("quality");
        assert_eq!(r.unmet_required_apis().len(), 1);
    }

    #[test]
    fn record_requires_api_ignores_empty_and_unregister_clears_it() {
        let r = PluginRegistry::default();
        r.record_requires_api("lonely", vec![]); // empty → not tracked
        assert!(r.unmet_required_apis().is_empty());
        r.record_requires_api("lonely", vec!["GhostApi".into()]);
        assert_eq!(r.unmet_required_apis().len(), 1);
        r.unregister("lonely");
        assert!(r.unmet_required_apis().is_empty());
    }
}
