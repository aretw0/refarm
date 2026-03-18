// Null Plugin — minimal test fixture for tractor-native integration tests.
//
// All lifecycle functions return immediately with success values.
// The plugin does NOT call any tractor-bridge host functions — it is purely
// a null implementation that lets the host exercise load() + setup() + lifecycle.

wit_bindgen::generate!({
    world: "refarm-plugin",
    path: "wit",
});

use exports::refarm::plugin::integration::{Guest, PluginError, PluginMetadata};

struct NullPlugin;

impl Guest for NullPlugin {
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
            name: "null-plugin".to_string(),
            version: "0.1.0".to_string(),
            description: "Null plugin for tractor-native integration tests".to_string(),
            supported_types: vec![],
            required_capabilities: vec![],
        }
    }

    fn on_event(_event: String, _payload: Option<String>) {}
}

export!(NullPlugin);
