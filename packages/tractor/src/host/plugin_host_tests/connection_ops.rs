    // `env_policy_core.rs` (the first file `include!`d into this flattened `tests`
    // module) already brings in `use super::*;` for the whole module — a second one
    // here would be a redundant glob, like every other duplicate-`use` case this
    // module tree already documents.
    //
    // These tests prove `PluginHost`'s three OPERATOR-facing connection methods
    // (`list_declared_connections` / `ensure_connection_as_operator` /
    // `stop_connection_as_operator`, all in `connection_ops.rs`) wire correctly to the
    // SAME shared engine `connection_claims.rs` already proves for the WIT/plugin
    // door — cheaply, via a bare `PluginHost::new()` (no `TractorNative::boot`, no
    // WASM). The HTTP-layer wiring itself (the sidecar routes calling these same
    // methods) is proven separately in `sidecar/tests/connection.rs`, including the
    // "up twice performs ONE establish" sharing guarantee at the HTTP layer.

    /// `.refarm/config.json`'s `connections` catalog is resolved fresh from the
    /// process CWD (`connections_catalog()` in `connection_host.rs`), so these tests
    /// point CWD at an isolated tempdir for their duration — restored via `Drop` so a
    /// panicking assertion mid-test still leaves CWD sane for whichever test runs
    /// next. Mirrors `host_effects_bridge_tests/connection_host.rs`'s own `CwdGuard`;
    /// duplicated rather than shared because that one is private to a DIFFERENT
    /// flattened module tree.
    struct CwdGuard {
        original: std::path::PathBuf,
    }

    impl CwdGuard {
        fn enter(dir: &std::path::Path) -> Self {
            let original = std::env::current_dir().expect("current_dir");
            std::env::set_current_dir(dir).expect("set_current_dir");
            Self { original }
        }
    }

    impl Drop for CwdGuard {
        fn drop(&mut self) {
            let _ = std::env::set_current_dir(&self.original);
        }
    }

    fn write_connections_config(dir: &std::path::Path, connections_json: &str) {
        let refarm_dir = dir.join(".refarm");
        std::fs::create_dir_all(&refarm_dir).unwrap();
        std::fs::write(
            refarm_dir.join("config.json"),
            format!(r#"{{"connections":{connections_json}}}"#),
        )
        .unwrap();
    }

    /// A declaration that reaches `Ready` on the first probe poll — the same trivial
    /// fixture `host_effects_bridge_tests/connection_host.rs` uses to exercise the
    /// REAL adapters end to end.
    fn trivial_connection_json() -> &'static str {
        r#"{ "c": { "establish": ["true"], "probe": { "run": ["true"] }, "probeIntervalMs": 1, "readyTimeoutMs": 5000 } }"#
    }

    fn bare_host() -> PluginHost {
        PluginHost::new(
            crate::trust::TrustManager::new(),
            crate::telemetry::TelemetryBus::new(10),
            crate::host::DEFAULT_ON_EVENT_BUDGET_MS,
        )
        .unwrap()
    }

    fn memory_sync() -> crate::sync::NativeSync {
        let storage = crate::storage::NativeStorage::open(":memory:").unwrap();
        crate::sync::NativeSync::new(storage, ":memory:").unwrap()
    }

    #[tokio::test]
    async fn list_declared_connections_reports_a_never_established_name_as_down() {
        let _env = crate::test_support::env_lock();
        ensure_sovereign_dir_env();
        let dir = tempfile::tempdir().unwrap();
        write_connections_config(dir.path(), trivial_connection_json());
        let _cwd = CwdGuard::enter(dir.path());

        let host = bare_host();
        let sync = memory_sync();

        let list = host.list_declared_connections(&sync).expect("list must succeed");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "c");
        assert_eq!(list[0].status, "down", "declared but never established ⇒ Down, never omitted");
        assert_eq!(list[0].claims, 0);
        assert_eq!(list[0].since_ns, None);
        assert_eq!(list[0].claim, None, "a list entry observes; it never mints a claim");
    }

    #[tokio::test]
    async fn ensure_connection_as_operator_shares_one_establish_under_the_operator_owner() {
        let _env = crate::test_support::env_lock();
        ensure_sovereign_dir_env();
        let dir = tempfile::tempdir().unwrap();
        write_connections_config(dir.path(), trivial_connection_json());
        let _cwd = CwdGuard::enter(dir.path());

        let host = bare_host();
        let sync = memory_sync();

        let first = host
            .ensure_connection_as_operator(&sync, "c")
            .await
            .expect("first ensure must succeed");
        assert_eq!(first.status, "up");
        let claim_1 = first.claim.expect("first call mints a claim");

        let second = host
            .ensure_connection_as_operator(&sync, "c")
            .await
            .expect("second ensure must succeed, sharing the live connection");
        let claim_2 = second.claim.expect("second call mints its own claim too");

        assert_ne!(claim_1, claim_2, "each call gets its own claim");
        assert_eq!(second.claims, 2, "both claims are attributed to the SAME connection");
        assert_eq!(
            host.connection_spawn_count("c"),
            1,
            "ensure twice must perform exactly ONE establish — the whole point of sharing"
        );

        // The claims belong to "operator" — release_owner for any OTHER string (the
        // shape a plugin's own unload path uses) must never touch them. This is the
        // safety property `CONNECTION_OWNER_OPERATOR`'s own doc names.
        host.release_connection_claims("some-unrelated-plugin");
        assert_eq!(
            host.list_declared_connections(&sync).unwrap()[0].claims,
            2,
            "an unrelated plugin's unload must not collect the operator's claims"
        );
    }

    #[tokio::test]
    async fn ensure_connection_as_operator_on_an_undeclared_name_errors_naming_it() {
        let _env = crate::test_support::env_lock();
        ensure_sovereign_dir_env();
        let dir = tempfile::tempdir().unwrap(); // no connections declared at all
        let _cwd = CwdGuard::enter(dir.path());

        let host = bare_host();
        let sync = memory_sync();

        let err = host
            .ensure_connection_as_operator(&sync, "serpro-vpn")
            .await
            .expect_err("an undeclared name must error, not silently succeed");
        match err {
            ConnectionOperatorError::Undeclared(message) => {
                assert!(
                    message.contains("serpro-vpn") && message.contains("declared"),
                    "must name the missing declaration: {message}"
                );
            }
            ConnectionOperatorError::Failed(message) => {
                panic!("undeclared name must be the Undeclared variant, not Failed: {message}")
            }
        }
    }

    #[tokio::test]
    async fn stop_connection_as_operator_reports_claims_and_takes_it_down() {
        let _env = crate::test_support::env_lock();
        ensure_sovereign_dir_env();
        let dir = tempfile::tempdir().unwrap();
        write_connections_config(dir.path(), trivial_connection_json());
        let _cwd = CwdGuard::enter(dir.path());

        let host = bare_host();
        let sync = memory_sync();

        host.ensure_connection_as_operator(&sync, "c").await.unwrap();
        host.ensure_connection_as_operator(&sync, "c").await.unwrap();

        let (state, claims_active) =
            host.stop_connection_as_operator("c").expect("stop of a declared name must succeed");
        assert_eq!(claims_active, 2, "both claims active at the moment of the stop must be reported");
        assert_eq!(state.status, "down");
        assert_eq!(state.claims, 0, "claims are cleared by the stop, not merely counted");
        assert_eq!(state.claim, None);

        // Idempotent: stopping an already-down connection is a clean no-op, not an error.
        let (state_2, claims_active_2) = host.stop_connection_as_operator("c").unwrap();
        assert_eq!(claims_active_2, 0);
        assert_eq!(state_2.status, "down");
    }

    #[tokio::test]
    async fn stop_connection_as_operator_on_an_undeclared_name_errors_naming_it() {
        let _env = crate::test_support::env_lock();
        ensure_sovereign_dir_env();
        let dir = tempfile::tempdir().unwrap(); // no connections declared at all
        let _cwd = CwdGuard::enter(dir.path());

        let host = bare_host();

        let err = host
            .stop_connection_as_operator("ghost")
            .expect_err("an undeclared name must error, not silently succeed");
        match err {
            ConnectionOperatorError::Undeclared(message) => {
                assert!(message.contains("ghost"), "must name the missing declaration: {message}");
            }
            ConnectionOperatorError::Failed(message) => {
                panic!("undeclared name must be the Undeclared variant, not Failed: {message}")
            }
        }
    }

    #[tokio::test]
    async fn a_plugin_whose_id_is_literally_operator_cannot_touch_the_operators_claims() {
        // CRITICAL-2 regression: `PluginHost::load` derives a plugin's runtime id as
        // EITHER the last `/`-segment of its manifest `id` (`@vendor/operator` ⇒
        // `operator`) OR, with no manifest at all, the wasm file's stem (a file literally
        // named `operator.wasm` ⇒ `operator`) — and the manifest validator reserves no
        // names. If `CONNECTION_OWNER_OPERATOR` were the bare string `"operator"`, such a
        // plugin's unload would silently sweep every operator claim via `release_owner`
        // (collect), and while still loaded it could `release()` the operator's claim by
        // GUESSING its id — claim ids come from one sequential, registry-wide counter, so
        // any plugin holding `connection:use` can enumerate them (release). Both vectors
        // must fail now that the owner is `"refarm/operator"`, a string neither derivation
        // can ever produce (neither can contain a `/`).
        let _env = crate::test_support::env_lock();
        ensure_sovereign_dir_env();
        let dir = tempfile::tempdir().unwrap();
        write_connections_config(dir.path(), trivial_connection_json());
        let _cwd = CwdGuard::enter(dir.path());

        let host = bare_host();
        let sync = memory_sync();

        let state = host.ensure_connection_as_operator(&sync, "c").await.unwrap();
        let claim_id = state.claim.expect("ensure mints a claim");
        assert_eq!(state.claims, 1);

        // COLLECT vector: a plugin whose runtime id is literally "operator" unloading
        // must not sweep the operator's claim.
        host.release_connection_claims("operator");
        assert_eq!(
            host.list_declared_connections(&sync).unwrap()[0].claims,
            1,
            "a plugin with runtime id 'operator' must NOT collect the operator's claim on unload"
        );

        // RELEASE vector: a plugin whose runtime id is literally "operator", still
        // loaded, must not be able to release the operator's claim by guessing its id.
        host.connection_release_claim_as(claim_id, "operator");
        assert_eq!(
            host.list_declared_connections(&sync).unwrap()[0].claims,
            1,
            "a plugin with runtime id 'operator' must NOT release the operator's claim by id"
        );

        // Sanity: the mechanism itself works — the REAL operator owner can still
        // release it. Proves the two assertions above are not vacuously true because
        // release_by_id is broken outright.
        host.connection_release_claim_as(claim_id, "refarm/operator");
        assert_eq!(
            host.list_declared_connections(&sync).unwrap()[0].claims,
            0,
            "sanity: the real operator owner must still be able to release its own claim"
        );
    }
