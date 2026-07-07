// Host implementation of the `capability-tools` WIT interface — the AGENT LEG (#6).
//
// The agent guest imports `capability-tools` (worlds.wit: effect-capable) to LIST
// the registry's dispatchable verbs as model tools and INVOKE one. The host owns the
// source of truth — the shared `PluginRegistry` of LOADED plugins + the event router
// — so it answers both from `self.cross_plugin` (cloned into the bindings at load).
//
// SECURITY. `list_tools`/`invoke_tool` only ever reach LOADED plugins: a revoked or
// untrusted plugin never loads (the Strict gate bails), so it is absent from the
// registry and its verbs are neither listable nor invokable. And an invoked verb runs
// in ITS OWN plugin instance, under ITS OWN load-time grant + linker (chosen when that
// plugin loaded) — never the agent's. Surfacing a verb to the agent therefore widens
// REACH, not POWER. No path lends the caller's authority to the callee.

// NOTE: this file is `include!`d into the `host_effects_bridge` module alongside
// core.rs, so `TractorNativeBindings` + the wasmtime async_trait macro are already
// in scope. Only the symbols core.rs does not already import are brought in here.
use crate::deliver_via_router;
use crate::host::plugin_host::refarm::plugin::capability_tools::Host as CapabilityToolsHost;
use crate::host::plugin_registry::DispatchableVerb;
use crate::host::wasi_bridge::CrossPluginAccess;

/// The node `@type` a dispatched verb stores its result under, and the field that
/// carries the correlation key — the convention proven by `vault_plugin_harness`.
const DISPATCH_RESULT_TYPE: &str = "refarm:DispatchResult";
const REPLY_REF_FIELD: &str = "refarm:replyRef";

/// How long `invoke_tool` waits for the target plugin to store its
/// `dispatch-result:v1` node before giving up, and how often it polls the graph.
/// The dispatch itself is delivered synchronously; only the RESULT is out-of-band,
/// so this bounds the correlation-await, not the delivery.
const INVOKE_TIMEOUT_MS: u64 = 30_000;
const INVOKE_POLL_INTERVAL_MS: u64 = 25;

/// Render one dispatchable verb as a provider-shaped tool schema (a JSON object
/// STRING the guest concatenates into its tool list). The verb's args are opaque to
/// the host, so — exactly like the #1 TS adapter's descriptor — the tool takes a
/// single variadic `args` array of `key=value` strings. `provider` selects the wire
/// envelope: "openai" wraps in `{type:function, function:{...}}`; anything else
/// (anthropic) uses `{name, description, input_schema}`.
fn render_tool_schema(verb: &DispatchableVerb, provider: &str) -> String {
    let name = format!("{}_{}", verb.plugin_key, verb.verb);
    let description = format!(
        "{} — dispatched to the {} plugin. Pass args as key=value strings.",
        verb.verb, verb.plugin_id
    );
    let parameters = serde_json::json!({
        "type": "object",
        "properties": {
            "args": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Verb arguments as key=value strings, e.g. note={\"path\":\"n.md\"}."
            }
        }
    });

    let schema = if provider == "openai" {
        serde_json::json!({
            "type": "function",
            "function": { "name": name, "description": description, "parameters": parameters }
        })
    } else {
        serde_json::json!({ "name": name, "description": description, "input_schema": parameters })
    };
    schema.to_string()
}

/// Render one usage-guidance line for a dispatchable verb, for the system prompt.
/// PROSE (not schema): it names the model-facing tool (`<key>_<verb>`), says it
/// routes to the plugin, and how args are shaped — the context the flat tool schema
/// under-explains. Same derivation source as `render_tool_schema` (the same
/// `DispatchableVerb`), so the guidance and the schema can never disagree.
fn render_tool_prompt(verb: &DispatchableVerb) -> String {
    format!(
        "Tool `{}_{}` dispatches to the `{}` plugin — pass its arguments as `args` \
         (key=value strings). Prefer it over shell/fs for anything the {} plugin owns.",
        verb.plugin_key, verb.verb, verb.plugin_id, verb.plugin_id
    )
}

/// Resolve a model-facing tool name (`<key>_<verb>`) back to the dispatchable verb it
/// names, among the currently-loaded plugins. Returns None if no loaded plugin
/// surfaces that verb (e.g. it was revoked/unloaded since the tool list was built).
fn resolve_tool<'a>(
    verbs: &'a [DispatchableVerb],
    tool_name: &str,
) -> Option<&'a DispatchableVerb> {
    verbs
        .iter()
        .find(|v| format!("{}_{}", v.plugin_key, v.verb) == tool_name)
}

#[wasmtime::component::__internal::async_trait]
impl CapabilityToolsHost for TractorNativeBindings {
    async fn list_tools(&mut self, provider: String) -> Vec<String> {
        let Some(cross) = self.cross_plugin.as_ref() else {
            return Vec::new(); // no registry wired → pre-registry behavior (empty)
        };
        cross
            .registry
            .dispatchable_verbs()
            .iter()
            .map(|verb| render_tool_schema(verb, &provider))
            .collect()
    }

    async fn list_tool_prompts(&mut self) -> Vec<String> {
        let Some(cross) = self.cross_plugin.as_ref() else {
            return Vec::new(); // no registry wired → no guidance
        };
        cross
            .registry
            .dispatchable_verbs()
            .iter()
            .map(render_tool_prompt)
            .collect()
    }

    async fn invoke_tool(
        &mut self,
        name: String,
        input_json: String,
    ) -> Result<String, String> {
        let Some(cross) = self.cross_plugin.as_ref() else {
            return Err("capability tools unavailable: no plugin registry wired".to_string());
        };

        // Resolve the tool name to a loaded, dispatchable verb. A tool the model
        // calls that no longer resolves (unloaded/revoked plugin) fails honestly.
        let verbs = cross.registry.dispatchable_verbs();
        let verb = resolve_tool(&verbs, &name)
            .ok_or_else(|| format!("no loaded plugin provides tool '{name}'"))?
            .clone();

        // Parse the model's JSON input; empty is allowed (a no-arg verb).
        let input: serde_json::Value = if input_json.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str(&input_json)
                .map_err(|e| format!("invalid tool input JSON: {e}"))?
        };

        // Everything after name→verb resolution is the shared dispatch — the SAME
        // path a plugin-to-plugin `call-plugin` uses. One protocol, two callers.
        dispatch_to_plugin(
            cross,
            &self.sync,
            &self.telemetry,
            &verb.plugin_id,
            &verb.plugin_key,
            &verb.verb,
            input,
        )
        .await
    }
}

/// Dispatch a verb to a loaded plugin and await its correlated result — the ONE
/// cross-plugin call protocol, shared by the agent leg's `invoke_tool` (which
/// resolves a model tool-name `<key>_<verb>` first) and the SPI `call_plugin`
/// (which receives a resolved `plugin_id` + `verb` directly). Mints a correlation
/// key, sends `{verb, ...args, replyRef}` on the `<key>:dispatch` event, and polls
/// for the plugin's `refarm:DispatchResult` node keyed by that replyRef.
///
/// Error-neutral (`Result<String, String>`): each caller adapts it to its own WIT
/// error type (`invoke_tool` returns the string as-is; `call_plugin` maps it into a
/// `plugin-error`). This is why the shared protocol lives here exactly once — no
/// replyRef/payload/router/await logic is duplicated across the two entry points.
pub(crate) async fn dispatch_to_plugin(
    cross: &CrossPluginAccess,
    sync: &crate::sync::NativeSync,
    telemetry: &crate::telemetry::TelemetryBus,
    plugin_id: &str,
    plugin_key: &str,
    verb: &str,
    input: serde_json::Value,
) -> Result<String, String> {
    // Mint a correlation key and build the dispatch payload the SAME way the
    // sidecar's `dispatch_event_effort` does: `{verb, ...args, replyRef}` on the
    // `<key>:dispatch` event. The plugin runs the verb and stores a
    // `refarm:DispatchResult` node carrying this replyRef (proven by the vault
    // harness); we await that node below.
    let reply_ref = format!("dispatch-{}", uuid::Uuid::new_v4());
    let event = format!("{plugin_key}:dispatch");
    let mut payload = serde_json::json!({ "verb": verb, "replyRef": reply_ref });
    if let Some(map) = input.as_object() {
        for (k, v) in map {
            payload[k] = v.clone();
        }
    } else if !input.is_null() {
        payload["args"] = input.clone();
    }

    let sent = deliver_via_router(
        &cross.event_router,
        &cross.plugin_channels,
        telemetry,
        &event,
        Some(plugin_id),
        Some(payload.to_string()),
    );
    if sent == 0 {
        return Err(format!(
            "verb '{verb}' could not be dispatched: plugin '{plugin_id}' is not receiving '{event}'"
        ));
    }

    // Correlation-await: poll the graph for the plugin's dispatch-result:v1 node
    // keyed by our replyRef, up to the timeout. This is the one piece the sandbox
    // requires that an in-process call would not — the verb result is on the far
    // side of an async WASM/store-node hop, so the host waits for it before
    // returning to the caller.
    await_dispatch_result(sync, &reply_ref).await
}

/// Poll `self.sync` for a `refarm:DispatchResult` node whose `refarm:replyRef`
/// matches `reply_ref`, returning its payload JSON string. Bounded by
/// `INVOKE_TIMEOUT_MS`; a timeout is an honest error, not a hang.
async fn await_dispatch_result(
    sync: &crate::sync::NativeSync,
    reply_ref: &str,
) -> Result<String, String> {
    let deadline = INVOKE_TIMEOUT_MS / INVOKE_POLL_INTERVAL_MS;
    for _ in 0..deadline {
        if let Ok(rows) = sync.query_nodes(DISPATCH_RESULT_TYPE) {
            for row in rows {
                if let Ok(node) = serde_json::from_str::<serde_json::Value>(&row.payload) {
                    if node[REPLY_REF_FIELD] == reply_ref {
                        return Ok(row.payload);
                    }
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(INVOKE_POLL_INTERVAL_MS)).await;
    }
    Err(format!(
        "tool dispatch timed out after {INVOKE_TIMEOUT_MS}ms waiting for result (replyRef {reply_ref})"
    ))
}
