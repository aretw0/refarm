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

    /// The SEAM itself: `TractorNative::unregister` (lib.rs) is the production
    /// caller of `PluginHost::release_connection_claims` — not a hypothetical.
    /// This drives it end to end through a REAL loaded plugin's REAL id (never a
    /// hand-picked string), which is the part the test above cannot show (it
    /// calls `release_connection_claims` directly).
    ///
    /// No WASM component in this repo imports `host-connection` yet (building
    /// one needs `cargo component build`, out of scope for this round), so the
    /// claim is minted directly through the shared registry — attributed to the
    /// plugin's genuine, host-assigned id — rather than via a guest's own
    /// `ensure` call. `tests/plugin_shutdown.rs` (an external integration-test
    /// crate) cannot express this: it only sees `PluginHost`'s `pub` surface,
    /// and `connection_registry` is deliberately NOT part of that (exposing the
    /// whole registry publicly on `PluginHost` would be a bigger surface change
    /// than this fix round warrants), so this lives here instead — a unit test
    /// inside the crate, where the private field is visible because this module
    /// is a descendant of `host::plugin_host`.
    #[tokio::test]
    async fn unregister_releases_connection_claims_for_the_real_plugin_id() {
        let component_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/null-plugin.wasm");
        if !component_path.exists() {
            eprintln!(
                "SKIP: null-plugin.wasm fixture missing at {}",
                component_path.display()
            );
            return;
        }

        // `null-plugin.wasm` has no sibling `plugin.json`, so it declares no integrity —
        // it loads only where the node declared it is under development. Declare it for
        // exactly this fixture's runtime id ("null-plugin", the file stem, since there is
        // no manifest id to derive it from) rather than wildcard-waive the whole boot.
        let _env = crate::test_support::env_lock();
        ensure_sovereign_dir_env();
        let dev_dir = tempfile::tempdir().unwrap();
        let refarm_dir = dev_dir.path().join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            r#"{"pluginDevelopment":{"null-plugin":{"declaredAt":"2026-08-26"}}}"#,
        )
        .unwrap();
        let _base = crate::test_support::DeclaredBaseGuard::enter(dev_dir.path());

        let tractor = crate::TractorNative::boot(crate::TractorNativeConfig {
            namespace: ":memory:".to_string(),
            port: 0,
            security_mode: crate::SecurityMode::None,
            ..Default::default()
        })
        .await
        .expect("boot tractor");

        let handle = tractor
            .load_plugin(&component_path)
            .await
            .expect("load null-plugin fixture");
        let plugin_id = handle.id.clone();
        tractor.register_for_events(handle);

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

        tractor
            .plugins
            .connection_registry
            .ensure("c", &plugin_id, &decls, spawn, &mut probe, &tractor.sync, &|| 0)
            .await
            .expect("ensure must succeed");
        assert_eq!(tractor.plugins.connection_registry.claim_count("c"), 1);

        let was_loaded = tractor.unregister(&plugin_id).await;
        assert!(was_loaded, "unregister must report the plugin was loaded");
        assert_eq!(
            tractor.plugins.connection_registry.claim_count("c"),
            0,
            "TractorNative::unregister must reach release_connection_claims for the REAL plugin id"
        );

        tractor.shutdown().await.expect("shutdown must succeed");
    }
