// Crash Plugin — a DELIBERATELY misbehaving fixture for resilience tests.
//
// Its `on_event` spins forever (a runaway extension). Under the host's epoch
// budget (REFARM_ON_EVENT_TIMEOUT_MS) the wasmtime store is trapped and torn
// down mid-event, and the respawn supervisor reinstantiates a fresh instance —
// so a single bad extension does NOT bring the sovereign machine down. The rest
// of the lifecycle returns success (only on_event misbehaves), so the plugin
// still loads and reports metadata normally.

wit_bindgen::generate!({
    world: "plugin",
    path: "../../../../plugin-wit/wit",
});

use exports::plugin::host::integration::{Guest, PluginError, PluginMetadata};

struct CrashPlugin;

impl Guest for CrashPlugin {
    fn setup() -> Result<(), PluginError> {
        Ok(())
    }

    fn ingest() -> Result<u32, PluginError> {
        Ok(0)
    }

    fn push(_payload: String) -> Result<(), PluginError> {
        Ok(())
    }

    fn teardown() {}

    fn get_help_nodes() -> Result<Vec<String>, PluginError> {
        Ok(vec![])
    }

    fn metadata() -> PluginMetadata {
        PluginMetadata {
            name: "crash-plugin".to_string(),
            version: "0.1.0".to_string(),
            description: "A runaway plugin whose on_event spins forever — proves host resilience".to_string(),
            supported_types: vec![],
            required_capabilities: vec![],
        }
    }

    // The misbehavior: an infinite loop with a volatile side effect the optimizer
    // cannot elide, so the guest genuinely never returns. The host's epoch budget
    // traps the store and the supervisor respawns a fresh instance.
    fn on_event(_event: String, _payload: Option<String>) {
        let mut spin: u64 = 0;
        loop {
            spin = spin.wrapping_add(1);
            core::hint::black_box(spin);
        }
    }

    fn respond(_payload: String) -> Result<String, PluginError> {
        Ok("{\"content\":\"crash-plugin\",\"model\":\"null\",\"provider\":\"null\",\"usage\":{\"tokens_in\":0,\"tokens_out\":0,\"estimated_usd\":0.0}}".to_string())
    }
}

export!(CrashPlugin);
