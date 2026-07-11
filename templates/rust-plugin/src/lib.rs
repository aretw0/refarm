wit_bindgen::generate!({
    world: "refarm-plugin",
    path: "../../packages/plugin-wit/wit",
});

use crate::exports::plugin::host::integration::{self, PluginError, PluginMetadata};

struct MyPlugin;

impl integration::Guest for MyPlugin {
    fn setup() -> Result<(), PluginError> {
        // Plugin setup logic
        Ok(())
    }

    fn ingest() -> Result<u32, PluginError> {
        // Ingestion logic
        Ok(0)
    }

    fn push(_payload: String) -> Result<(), PluginError> {
        // Push logic
        Ok(())
    }

    fn teardown() {
        // Cleanup logic
    }

    fn get_help_nodes() -> Result<Vec<String>, PluginError> {
        Ok(vec![])
    }

    fn metadata() -> PluginMetadata {
        PluginMetadata {
            name: "Rust Template Plugin".to_string(),
            version: "0.1.0".to_string(),
            description: "A template for building Refarm plugins in Rust".to_string(),
            supported_types: vec!["Repository".to_string()],
            required_capabilities: vec!["network:https://api.github.com".to_string()],
        }
    }

    fn on_event(_event: String, _payload: Option<String>) {
        // Event handler
    }

    // This plugin does not respond to agent-style requests. The interface is
    // shared by every plugin; a plugin that does not respond returns a stub.
    fn respond(_payload: String) -> Result<String, PluginError> {
        Err(PluginError::NotPermitted(
            "this plugin does not respond".to_string(),
        ))
    }
}

export!(MyPlugin);
