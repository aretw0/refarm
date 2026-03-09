wit_bindgen::generate!();

use crate::exports::refarm::plugin::plugin::{self, PluginMetadata};

/// Simple WASM Plugin for Testing JCO Integration
///
/// This plugin exports functions that match the refarm:plugin world.
/// The Plugin struct is never constructed directly — wit-bindgen generates
/// the glue code that calls these trait methods from WASM exports.

#[allow(dead_code)]
struct Plugin;

impl plugin::Guest for Plugin {
    fn setup() -> Result<(), String> {
        // Plugin initialization
        Ok(())
    }

    fn ingest() -> Result<u32, String> {
        // Simulate ingesting 0 items
        Ok(0)
    }

    fn push(_payload: String) -> Result<(), String> {
        // Mock push handler
        Ok(())
    }

    fn teardown() {
        // Cleanup hook
    }

    fn get_help_nodes() -> Result<Vec<String>, String> {
        // Return empty help nodes
        Ok(vec![])
    }

    fn metadata() -> PluginMetadata {
        PluginMetadata {
            name: "Simple WASM Plugin".to_string(),
            version: "0.1.0".to_string(),
            description: "A simple plugin for testing JCO Component Model integration".to_string(),
            supported_types: vec!["Test".to_string()],
            required_capabilities: vec![],
        }
    }

    fn on_event(_event: String, _payload: Option<String>) {
        // Event handler stub
    }
}
