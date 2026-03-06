// Hello World Plugin - Validação WASM + WIT
// Implementa a interface refarm-sdk.wit

mod bindings;

use bindings::exports::refarm::sdk::integration::{Guest, PluginError, PluginMetadata};
use bindings::refarm::sdk::kernel_bridge::{log, store_node, LogLevel};

struct HelloWorldPlugin;

impl Guest for HelloWorldPlugin {
    fn setup() -> Result<(), PluginError> {
        log(LogLevel::Info, "🦀 Hello from Rust WASM setup!");
        Ok(())
    }

    fn ingest() -> Result<u32, PluginError> {
        log(LogLevel::Info, "📥 Ingesting data...");

        // Create a dummy JSON-LD node
        let node = r#"{
            "@context": "https://schema.org",
            "@type": "Note",
            "@id": "urn:hello-world:note-1",
            "name": "Hello from WASM!",
            "text": "This note was created by a Rust plugin running in the browser",
            "dateCreated": "2026-03-06T00:00:00Z"
        }"#;

        // Store via kernel bridge
        match store_node(node) {
            Ok(node_id) => {
                log(
                    LogLevel::Info,
                    &format!("✅ Stored node with ID: {}", node_id),
                );
                Ok(1)
            }
            Err(e) => {
                log(LogLevel::Error, &format!("❌ Failed to store node: {}", e));
                Err(PluginError {
                    code: "STORE_FAILED".to_string(),
                    message: e,
                })
            }
        }
    }

    fn push(_payload: String) -> Result<(), PluginError> {
        log(LogLevel::Info, "📤 Push not implemented in hello-world");
        Ok(())
    }

    fn teardown() {
        log(LogLevel::Info, "👋 Goodbye from Rust WASM!");
    }

    fn metadata() -> PluginMetadata {
        PluginMetadata {
            name: "Hello World Plugin".to_string(),
            version: "0.1.0".to_string(),
            description: "Minimal validation plugin for WASM + WIT".to_string(),
            supported_types: vec!["Note".to_string()],
            required_capabilities: vec![],
        }
    }
}

bindings::export!(HelloWorldPlugin with_types_in bindings);
