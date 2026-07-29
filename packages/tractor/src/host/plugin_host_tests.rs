/// The substrate no longer defaults the sovereign config dir — it reads
/// SOVEREIGN_DIR (injected by the app). These tests write their fixture under
/// `<tmp>/.refarm/config.json`, so they stand in for the app and select ".refarm".
/// Idempotent + thread-safe (one fixed value, no race); called by every test that
/// exercises the config-file read path.
fn ensure_sovereign_dir_env() {
    use std::sync::Once;
    static SET: Once = Once::new();
    SET.call_once(|| std::env::set_var("SOVEREIGN_DIR", ".refarm"));
}

include!("plugin_host_tests/env_policy_core.rs");
include!("plugin_host_tests/env_policy_edges.rs");
include!("plugin_host_tests/p1_module_loader.rs");
include!("plugin_host_tests/epoch_semantics.rs");
include!("plugin_host_tests/connection_claims.rs");
