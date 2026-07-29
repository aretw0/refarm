    // `env_policy_core.rs` (the first file `include!`d into this flattened `tests`
    // module) already brings in `use super::*;` for the whole module — a second
    // one here would be a redundant glob (harmless, but flagged `unused_imports`).

    /// `TractorNative::unregister` (lib.rs) — the crate's single clean plugin-unload
    /// point — calls `PluginHost::release_connection_claims(plugin_id)`. This proves
    /// that method is a real delegation to the shared registry's `release_owner`,
    /// not a no-op: `release_owner`'s own claim bookkeeping is already covered at
    /// the engine layer (`connection_engine_tests`), so this test only needs to
    /// show `PluginHost` reaches the SAME registry it hands to every plugin's
    /// bindings — accessed here as a private field, visible because this test
    /// module is a descendant of `host::plugin_host`.
    #[tokio::test]
    async fn release_connection_claims_delegates_to_the_shared_registry() {
        let host = PluginHost::new(
            crate::trust::TrustManager::new(),
            crate::telemetry::TelemetryBus::new(10),
            crate::host::DEFAULT_ON_EVENT_BUDGET_MS,
        )
        .unwrap();

        let decls = crate::host::host_effects_bridge::parse_connections(&serde_json::json!({
            "connections": {
                "c": {
                    "establish": ["true"],
                    "probe": { "run": ["true"] },
                    "probeIntervalMs": 1,
                    "readyTimeoutMs": 5000
                }
            }
        }))
        .unwrap();

        let storage = crate::storage::NativeStorage::open(":memory:").unwrap();
        let sync = crate::sync::NativeSync::new(storage, ":memory:").unwrap();
        let policy = crate::host::host_effects_bridge::HostEffectPolicy::default();

        let probe_decls = decls.clone();
        let probe_policy = policy.clone();
        let mut probe = move || {
            let decl = probe_decls.get("c").unwrap().clone();
            let policy = probe_policy.clone();
            async move { crate::host::host_effects_bridge::run_probe(&decl, &policy).await }
        };
        let spawn = move |decl: &crate::host::host_effects_bridge::ConnectionDeclaration| {
            crate::host::host_effects_bridge::spawn_establish_process(decl, &policy)
        };

        host.connection_registry
            .ensure("c", "plugin-a", &decls, spawn, &mut probe, &sync, &|| 0)
            .await
            .expect("ensure must succeed");

        assert_eq!(host.connection_registry.claim_count("c"), 1);
        host.release_connection_claims("plugin-a");
        assert_eq!(
            host.connection_registry.claim_count("c"),
            0,
            "release_connection_claims must reach the SAME registry every plugin's bindings share"
        );
    }
