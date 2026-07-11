//! LSP Code Ops — the first NON-AGENT effect-capable plugin.
//!
//! It imports the host `code-ops` interface (LSP-backed rename / find-references) and
//! SURFACES those operations to the agent as dispatchable verbs (`code-ops:find-references`,
//! `code-ops:rename-symbol`). This proves the `capability-tools` seam with a real host
//! import: the agent lists these verbs as model tools and invokes them, and THIS plugin
//! runs the LSP call under ITS OWN grant — the agent never depends on it (`requires: []`
//! on both sides). Extracting these two ops out of the agent's built-ins is what keeps the
//! agent minimal while the sophistication (LSP, gap #6) lives as a core-plugin.
//!
//! DISPATCH CONTRACT (mirrors the host's `dispatch_to_plugin`): the host delivers a
//! `code-ops:dispatch` event whose payload is `{ verb, replyRef, ...args }`; this plugin
//! runs the verb and stores a `refarm:DispatchResult` node carrying that `replyRef` plus
//! the result, which the host's correlation-await returns to the agent.
//!
//! The parse + result-node shaping are PURE and native-testable; the wasm guest is a thin
//! wiring layer over them.

#[cfg(target_arch = "wasm32")]
#[allow(warnings)]
mod bindings {
    wit_bindgen::generate!({
        path: "../plugin-wit/wit",
        world: "effect-capable",
    });
}

/// The node `@type` a dispatch result is stored under, and the correlation-key field —
/// the exact strings the host's `await_dispatch_result` polls for.
const DISPATCH_RESULT_TYPE: &str = "refarm:DispatchResult";
const REPLY_REF_FIELD: &str = "refarm:replyRef";
const RESULT_FIELD: &str = "refarm:result";
/// The routing key this plugin serves (mirrors `verbs.key` in plugin.json). The event we
/// receive is `<KEY>:dispatch`. Used only by the wasm guest's `on_event`.
#[cfg(target_arch = "wasm32")]
const DISPATCH_KEY: &str = "code-ops";

/// A parsed dispatch request: which verb, the correlation key, and the raw arg object.
#[derive(Debug, Clone, PartialEq)]
struct DispatchRequest {
    verb: String,
    reply_ref: String,
    args: serde_json::Value,
}

/// Parse the `<key>:dispatch` payload into a `DispatchRequest`. Returns None when the
/// payload is not the expected `{ verb, replyRef, ... }` object (a malformed dispatch is
/// ignored, not stored). The remaining keys (minus verb/replyRef) are the verb's args.
fn parse_dispatch(payload: &str) -> Option<DispatchRequest> {
    let value: serde_json::Value = serde_json::from_str(payload).ok()?;
    let obj = value.as_object()?;
    let verb = obj.get("verb")?.as_str()?.to_string();
    let reply_ref = obj.get("replyRef")?.as_str()?.to_string();
    // Args = the payload minus the two envelope fields.
    let mut args = serde_json::Map::new();
    for (k, v) in obj {
        if k != "verb" && k != "replyRef" {
            args.insert(k.clone(), v.clone());
        }
    }
    Some(DispatchRequest {
        verb,
        reply_ref,
        args: serde_json::Value::Object(args),
    })
}

/// Build the `refarm:DispatchResult` node the host awaits: it carries the correlation key
/// and the verb's result payload (`result` is any JSON — an array for find-references, an
/// object for rename, or an `{ error }` object on failure). PURE: takes the result value,
/// returns the node value; the guest serializes + stores it.
fn build_dispatch_result_node(reply_ref: &str, result: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "@id": format!("urn:refarm:dispatch-result:{reply_ref}"),
        "@type": DISPATCH_RESULT_TYPE,
        REPLY_REF_FIELD: reply_ref,
        RESULT_FIELD: result,
    })
}

/// Shape a find-references result list (host `code-reference` records) into the JSON array
/// the agent sees — one object per reference with file/line/column/kind. PURE.
fn find_references_result(refs: &[(String, u32, u32, String)]) -> serde_json::Value {
    serde_json::Value::Array(
        refs.iter()
            .map(|(file, line, column, kind)| {
                serde_json::json!({ "file": file, "line": line, "column": column, "kind": kind })
            })
            .collect(),
    )
}

/// Shape a rename result (files-changed, edits-applied) into the agent-facing object. PURE.
fn rename_result(files_changed: u32, edits_applied: u32) -> serde_json::Value {
    serde_json::json!({ "filesChanged": files_changed, "editsApplied": edits_applied })
}

/// An error result payload (a verb whose host call failed): `{ error: <message> }`. PURE —
/// the plugin ALWAYS stores a result node (even on error) so the agent's await never hangs.
fn error_result(message: &str) -> serde_json::Value {
    serde_json::json!({ "error": message })
}

/// Extract a `symbol-location` triple (file, line, column) from a verb's args. Returns None
/// if any is missing/ill-typed — the caller turns that into an error result. PURE.
fn parse_symbol_location(args: &serde_json::Value) -> Option<(String, u32, u32)> {
    let file = args.get("file")?.as_str()?.to_string();
    let line = args.get("line")?.as_u64()? as u32;
    let column = args.get("column")?.as_u64()? as u32;
    Some((file, line, column))
}

// ── wasm guest ────────────────────────────────────────────────────────────────
#[cfg(target_arch = "wasm32")]
mod guest {
    use super::*;
    use bindings::exports::plugin::host::integration::{
        Guest as IntegrationGuest, PluginError, PluginMetadata,
    };
    use bindings::plugin::host::code_ops::{self, SymbolLocation};
    use bindings::plugin::host::tractor_bridge;

    struct LspCodeOps;

    /// Run a dispatched verb against the host `code-ops` interface, returning the
    /// agent-facing result value (an error result on any failure — never propagates).
    fn run_verb(verb: &str, args: &serde_json::Value) -> serde_json::Value {
        let Some((file, line, column)) = parse_symbol_location(args) else {
            return error_result("requires file, line, and column");
        };
        let loc = SymbolLocation { file, line, column };
        match verb {
            "find-references" => match code_ops::find_references(&loc) {
                Ok(refs) => {
                    let tuples: Vec<(String, u32, u32, String)> = refs
                        .into_iter()
                        .map(|r| (r.file, r.line, r.column, r.kind))
                        .collect();
                    find_references_result(&tuples)
                }
                Err(e) => error_result(&e),
            },
            "rename-symbol" => {
                let Some(new_name) = args.get("new_name").and_then(|v| v.as_str()) else {
                    return error_result("rename-symbol requires new_name");
                };
                match code_ops::rename_symbol(&loc, new_name) {
                    Ok(r) => rename_result(r.files_changed, r.edits_applied),
                    Err(e) => error_result(&e),
                }
            }
            other => error_result(&format!("unknown verb '{other}'")),
        }
    }

    impl IntegrationGuest for LspCodeOps {
        fn setup() -> Result<(), PluginError> {
            tractor_bridge::emit_telemetry("lsp-code-ops:ready", None);
            Ok(())
        }

        fn ingest() -> Result<u32, PluginError> {
            Ok(0)
        }

        fn push(_payload: String) -> Result<(), PluginError> {
            Err(PluginError::NotPermitted(
                "lsp-code-ops does not accept push".to_string(),
            ))
        }

        fn teardown() {}

        fn get_help_nodes() -> Result<Vec<String>, PluginError> {
            Ok(vec![])
        }

        fn metadata() -> PluginMetadata {
            PluginMetadata {
                name: "lsp-code-ops".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                description: "LSP-backed rename / find-references, surfaced to the agent"
                    .to_string(),
                supported_types: vec!["refarm:DispatchResult".to_string()],
                required_capabilities: vec!["code-ops".to_string(), "host-shell".to_string()],
            }
        }

        fn on_event(event: String, payload: Option<String>) {
            // Only our dispatch channel matters; anything else is ignored.
            if event != format!("{DISPATCH_KEY}:dispatch") {
                return;
            }
            let Some(payload) = payload else { return };
            let Some(req) = parse_dispatch(&payload) else {
                return;
            };
            let result = run_verb(&req.verb, &req.args);
            let node = build_dispatch_result_node(&req.reply_ref, result);
            let _ = tractor_bridge::store_node(&node.to_string());
        }

        fn respond(_payload: String) -> Result<String, PluginError> {
            Err(PluginError::NotPermitted(
                "lsp-code-ops is dispatch-only; it does not respond".to_string(),
            ))
        }
    }

    bindings::export!(LspCodeOps with_types_in bindings);
}

#[cfg(test)]
mod tests;
