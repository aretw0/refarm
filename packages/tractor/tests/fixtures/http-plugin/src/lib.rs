// HTTP Plugin — test fixture that IMPORTS wasi:http/outgoing-handler.
//
// Its whole purpose is to prove the `network:outbound` grant is a real linker
// boundary end-to-end. The host builds two linkers: one WITH wasi:http
// (add_only_http_to_linker_async) for plugins granted `network:outbound`, and
// one WITHOUT (linker_no_http) for un-granted plugins. This plugin imports
// `wasi:http/outgoing-handler`, so:
//   - granted (or dev/Permissive) → links against the http linker → loads.
//   - Strict + grant omitted     → links against linker_no_http → the
//     outgoing-handler import fails to resolve → load errors.
//
// CRITICAL: the http import must be REACHABLE from an exported function, or
// LTO+DCE would strip it and the plugin would load fine even without the grant,
// silently defeating the test. `on_event` below issues a real
// `outgoing-handler::handle` call reachable from the export. It is never invoked
// during load (the host resolves imports at instantiation, before any export
// runs), so the request is never actually sent — but the import survives DCE.

#[allow(warnings)]
mod bindings;

use bindings::exports::refarm::plugin::integration::{Guest, PluginError, PluginMetadata};
use bindings::wasi::http::outgoing_handler;
use bindings::wasi::http::types::{Fields, OutgoingRequest, Scheme};

struct HttpPlugin;

/// Reachable use of `wasi:http/outgoing-handler`. Constructs an outgoing
/// request and calls `handle` — this pins the import so DCE cannot remove it.
/// Returns whether the call was accepted; errors are swallowed (the fixture
/// never asserts on the network, only that the import must LINK).
fn touch_http() -> bool {
    let headers = Fields::new();
    let req = OutgoingRequest::new(headers);
    let _ = req.set_scheme(Some(&Scheme::Https));
    let _ = req.set_authority(Some("example.invalid"));
    // The gated call. If the plugin linked against linker_no_http this symbol
    // would be unresolved and the plugin would fail to instantiate.
    outgoing_handler::handle(req, None).is_ok()
}

impl Guest for HttpPlugin {
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
            name: "http-plugin".to_string(),
            version: "0.1.0".to_string(),
            description: "Fixture importing wasi:http/outgoing-handler to test the network:outbound grant".to_string(),
            supported_types: vec![],
            required_capabilities: vec!["network:outbound".to_string()],
        }
    }

    // Reachable from the export table → keeps the http import alive under DCE.
    // Guarded on a payload that never matches during load, so no request is sent.
    fn on_event(event: String, _payload: Option<String>) {
        if event == "__never_fires_during_load__" {
            let _ = touch_http();
        }
    }

    fn respond(_payload: String) -> Result<String, PluginError> {
        Ok("{\"content\":\"http-plugin\",\"model\":\"null\",\"provider\":\"null\",\"usage\":{\"tokens_in\":0,\"tokens_out\":0,\"estimated_usd\":0.0}}".to_string())
    }
}

// Root the macro's type paths at the `bindings` module (not the crate root,
// where `exports` isn't in scope).
bindings::export!(HttpPlugin with_types_in bindings);
