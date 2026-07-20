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
use crate::host::plugin_host::plugin::host::capability_tools::Host as CapabilityToolsHost;
use crate::host::plugin_registry::DispatchableVerb;
use crate::host::wasi_bridge::CrossPluginAccess;

/// The node `@type` a dispatched verb stores its result under, and the field that
/// carries the correlation key — the convention proven by `vault_plugin_harness`.
const DISPATCH_RESULT_TYPE: &str = "DispatchResult";
const REPLY_REF_FIELD: &str = "replyRef";

/// How long `invoke_tool` waits for the target plugin to store its
/// `dispatch-result:v1` node before giving up, and how often it polls the graph.
/// The dispatch itself is delivered synchronously; only the RESULT is out-of-band,
/// so this bounds the correlation-await, not the delivery.
const INVOKE_TIMEOUT_MS: u64 = 30_000;
const INVOKE_POLL_INTERVAL_MS: u64 = 25;

/// Render one dispatchable verb as a provider-shaped tool schema (a JSON object
/// STRING the guest concatenates into its tool list).
///
/// TWO SHAPES, ONE RENDERER, chosen by whether the plugin DECLARED the verb's arg
/// schema (`capabilities.verbSchemas`, carried on `verb.schema`):
///   - DECLARED → the plugin's own JSON-Schema object becomes the tool's parameters
///     verbatim, so the verb reaches the model TYPED (named args, `required`, etc.) —
///     the same fidelity the #1 TS projector produces from a descriptor.
///   - ABSENT → a single variadic `args` array of `key=value` strings. This is NOT a
///     compatibility fallback: it is the correct schema for a verb whose arg shape is
///     genuinely opaque to the host (the plugin chose not to declare one).
///
/// The dispatch path accepts BOTH: `dispatch_to_plugin` spreads a JSON object's keys
/// into the payload (typed args) and, failing that, forwards a bare value under `args`
/// (the variadic case) — so a typed schema needs no new invoke wiring.
///
/// `provider` selects the wire envelope: "openai" wraps in `{type:function,
/// function:{...}}`; anything else (anthropic) uses `{name, description, input_schema}`.
fn render_tool_schema(verb: &DispatchableVerb, provider: &str) -> String {
    let name = format!("{}_{}", verb.plugin_key, verb.verb);
    // A declared schema teaches the verb's true form; absent, describe the variadic tool.
    let description = match &verb.schema {
        Some(_) => format!("{} — dispatched to the {} plugin.", verb.verb, verb.plugin_id),
        None => format!(
            "{} — dispatched to the {} plugin. Pass args as key=value strings.",
            verb.verb, verb.plugin_id
        ),
    };
    let parameters = verb.schema.clone().unwrap_or_else(|| {
        serde_json::json!({
            "type": "object",
            "properties": {
                "args": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Verb arguments as key=value strings, e.g. note={\"path\":\"n.md\"}."
                }
            }
        })
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
    // Plugin-authored prose (verbDocs) wins over the host boilerplate — the plugin
    // author teaches the agent how to use its tool (promptSnippet Slice 2).
    if let Some(doc) = &verb.doc {
        return doc.clone();
    }
    // Absent authored prose, the boilerplate must agree with the SCHEMA render: a
    // typed verb takes named args (per its schema), a variadic one takes `args` strings.
    let arg_hint = if verb.schema.is_some() {
        "pass its arguments per the tool's schema"
    } else {
        "pass its arguments as `args` (key=value strings)"
    };
    format!(
        "Tool `{}_{}` dispatches to the `{}` plugin — {arg_hint}. Prefer it over \
         shell/fs for anything the {} plugin owns.",
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

/// Validate a model's tool-call `input` against the verb's DECLARED JSON Schema — the
/// SAME schema `render_tool_schema` shows the model — for parity with the web/HTTP/CLI/TUI
/// surfaces, which validate capability args via Ajv (`validateCapabilityArgs`) before
/// dispatch. Returns `Err(message)` ONLY when the input definitely violates the schema, so
/// the agent leg rejects a malformed tool call up front (the error flows back to the model
/// as the tool result) instead of spreading bad args into the plugin payload.
///
/// Fail-OPEN on a schema that will not compile: a plugin-authored schema bug can enforce
/// nothing, and the model already saw that schema verbatim — better to let the call through
/// (unvalidated, as before this gate) than to wedge the tool on the author's mistake.
pub(crate) fn validate_tool_input(
    schema: &serde_json::Value,
    input: &serde_json::Value,
) -> Result<(), String> {
    let Ok(validator) = jsonschema::validator_for(schema) else {
        return Ok(()); // uncompilable schema → nothing enforceable; fail open
    };
    if validator.is_valid(input) {
        return Ok(());
    }
    // Fold the violations into one compact, deterministic, model-readable line. Prefix each with its
    // JSON-pointer instance path (e.g. `/limit`) so a type/enum error NAMES the offending field — the way
    // a `required` error already names the missing property in its message. This lets the model (and the
    // cross-language conformance fixture) pin the fault to a field identically to every TS surface.
    let mut messages: Vec<String> = validator
        .iter_errors(input)
        .map(|e| {
            let path = e.instance_path().as_str();
            if path.is_empty() {
                e.to_string()
            } else {
                format!("{path}: {e}")
            }
        })
        .collect();
    messages.sort();
    messages.dedup();
    Err(format!("invalid tool input: {}", messages.join("; ")))
}

/// Find a dispatchable verb by its plugin id + verb name and return its declared schema, if any — the
/// lookup the SPI `call_plugin` path uses to validate a plugin→plugin call. (The agent leg's
/// `invoke_tool` resolves by the model tool-name instead; both end at the same `verb.schema`.)
pub(crate) fn resolve_verb_schema<'a>(
    verbs: &'a [DispatchableVerb],
    plugin_id: &str,
    verb: &str,
) -> Option<&'a serde_json::Value> {
    verbs
        .iter()
        .find(|v| v.plugin_id == plugin_id && v.verb == verb)
        .and_then(|v| v.schema.as_ref())
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

        // PARITY with the web/HTTP/CLI/TUI surfaces: when the verb DECLARED a schema —
        // the one render_tool_schema showed the model — validate the model's input against
        // it before dispatch, so a malformed tool call is rejected up front (the error
        // returns to the model) instead of spreading bad args into the plugin payload. A
        // verb with no declared schema (the variadic `{args}` tool) has nothing to enforce.
        if let Some(schema) = &verb.schema {
            validate_tool_input(schema, &input)?;
        }

        // Everything after name→verb resolution is the shared dispatch — the SAME
        // path a plugin-to-plugin `call-plugin` uses. One protocol, two callers.
        // `self.plugin_id` is the CALLER, so the agent invoking its OWN `agent_respond`
        // tool is recognized as a self-dispatch and re-entered on a fresh instance.
        dispatch_to_plugin(
            cross,
            &self.sync,
            &self.telemetry,
            DispatchTarget {
                caller_id: &self.plugin_id,
                plugin_id: &verb.plugin_id,
                plugin_key: &verb.plugin_key,
                verb: &verb.verb,
            },
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
/// for the plugin's `DispatchResult` node keyed by that replyRef.
///
/// Error-neutral (`Result<String, String>`): each caller adapts it to its own WIT
/// error type (`invoke_tool` returns the string as-is; `call_plugin` maps it into a
/// `plugin-error`). This is why the shared protocol lives here exactly once — no
/// replyRef/payload/router/await logic is duplicated across the two entry points.
/// The addressing for one dispatch: WHO is calling (`caller_id`, to detect self-dispatch),
/// WHICH plugin + routing key the verb lives on, and the verb name. Grouped so the shared
/// `dispatch_to_plugin` protocol takes the target as one value instead of four positional
/// strings (and so a self-dispatch check has the caller alongside the target).
pub(crate) struct DispatchTarget<'a> {
    pub(crate) caller_id: &'a str,
    pub(crate) plugin_id: &'a str,
    pub(crate) plugin_key: &'a str,
    pub(crate) verb: &'a str,
}

pub(crate) async fn dispatch_to_plugin(
    cross: &CrossPluginAccess,
    sync: &crate::sync::NativeSync,
    telemetry: &crate::telemetry::TelemetryBus,
    target: DispatchTarget<'_>,
    input: serde_json::Value,
) -> Result<String, String> {
    let DispatchTarget { caller_id, plugin_id, plugin_key, verb } = target;
    // SELF-DISPATCH: a plugin invoking a verb on its OWN id can't go through the event +
    // runner path — its single runner thread is what would drain the dispatch event, but
    // it is (below) parked in await_dispatch_result → deadlock. Run the verb on a FRESH
    // instance instead and return the result inline. Implicit: any dispatchable verb is
    // self-dispatchable, no flag. (See host/self_dispatch.rs.)
    if crate::host::self_dispatch::is_self_dispatch(caller_id, plugin_id) {
        return crate::host::self_dispatch::run_self_dispatch(cross, plugin_id, verb, input).await;
    }

    // Mint a correlation key and build the dispatch payload the SAME way the
    // sidecar's `dispatch_event_effort` does: `{verb, ...args, replyRef}` on the
    // `<key>:dispatch` event. The plugin runs the verb and stores a
    // `DispatchResult` node carrying this replyRef (proven by the vault
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

/// Poll `self.sync` for a `DispatchResult` node whose `replyRef`
/// matches `reply_ref`, returning its payload JSON string. Bounded by
/// `INVOKE_TIMEOUT_MS`; a timeout is an honest error, not a hang.
async fn await_dispatch_result(
    sync: &crate::sync::NativeSync,
    reply_ref: &str,
) -> Result<String, String> {
    // A WALL-CLOCK deadline, not an iteration count: a slow `query_nodes` must not let the real timeout
    // drift past INVOKE_TIMEOUT_MS (previously `TIMEOUT/INTERVAL` iterations, each of unbounded query cost).
    // Same deadline idiom as readers.rs's poll loops. The deadline is checked AFTER the query, so a result
    // that lands right at the boundary is still returned.
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(INVOKE_TIMEOUT_MS);
    loop {
        if let Ok(rows) = sync.query_nodes(DISPATCH_RESULT_TYPE) {
            for row in rows {
                if let Ok(node) = serde_json::from_str::<serde_json::Value>(&row.payload) {
                    if node[REPLY_REF_FIELD] == reply_ref {
                        return Ok(row.payload);
                    }
                }
            }
        }
        if std::time::Instant::now() >= deadline {
            return Err(format!(
                "tool dispatch timed out after {INVOKE_TIMEOUT_MS}ms waiting for result (replyRef {reply_ref})"
            ));
        }
        tokio::time::sleep(std::time::Duration::from_millis(INVOKE_POLL_INTERVAL_MS)).await;
    }
}

#[cfg(test)]
mod capability_tools_pure_tests {
    use super::*;

    /// Build a `DispatchableVerb` with the given identity, no doc, no schema.
    fn verb(plugin_id: &str, plugin_key: &str, name: &str) -> DispatchableVerb {
        DispatchableVerb {
            plugin_id: plugin_id.to_string(),
            plugin_key: plugin_key.to_string(),
            verb: name.to_string(),
            doc: None,
            schema: None,
        }
    }

    /// The variadic `{ args }` parameters render_tool_schema emits when a verb
    /// declares no schema — mirrors the source object exactly for comparison.
    fn variadic_params() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "args": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Verb arguments as key=value strings, e.g. note={\"path\":\"n.md\"}."
                }
            }
        })
    }

    // ---- render_tool_schema -------------------------------------------------

    #[test]
    fn render_tool_schema_openai_declared_uses_schema_verbatim_under_function_envelope() {
        let mut v = verb("@scope/vault", "vault", "search");
        let declared = serde_json::json!({
            "type": "object",
            "properties": { "query": { "type": "string" } },
            "required": ["query"]
        });
        v.schema = Some(declared.clone());

        let rendered: serde_json::Value =
            serde_json::from_str(&render_tool_schema(&v, "openai")).unwrap();

        assert_eq!(
            rendered,
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": "vault_search",
                    "description": "search — dispatched to the @scope/vault plugin.",
                    "parameters": declared
                }
            })
        );
    }

    #[test]
    fn render_tool_schema_anthropic_declared_uses_input_schema_envelope() {
        let mut v = verb("@scope/vault", "vault", "search");
        let declared = serde_json::json!({
            "type": "object",
            "properties": { "query": { "type": "string" } }
        });
        v.schema = Some(declared.clone());

        // Any non-"openai" provider selects the anthropic envelope.
        let rendered: serde_json::Value =
            serde_json::from_str(&render_tool_schema(&v, "anthropic")).unwrap();

        assert_eq!(
            rendered,
            serde_json::json!({
                "name": "vault_search",
                "description": "search — dispatched to the @scope/vault plugin.",
                "input_schema": declared
            })
        );
    }

    #[test]
    fn render_tool_schema_openai_absent_schema_emits_variadic_args_and_keyvalue_hint() {
        let v = verb("@scope/notes", "notes", "append");

        let rendered: serde_json::Value =
            serde_json::from_str(&render_tool_schema(&v, "openai")).unwrap();

        assert_eq!(
            rendered,
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": "notes_append",
                    "description": "append — dispatched to the @scope/notes plugin. Pass args as key=value strings.",
                    "parameters": variadic_params()
                }
            })
        );
    }

    #[test]
    fn render_tool_schema_anthropic_absent_schema_emits_variadic_input_schema() {
        let v = verb("@scope/notes", "notes", "append");

        let rendered: serde_json::Value =
            serde_json::from_str(&render_tool_schema(&v, "claude")).unwrap();

        assert_eq!(
            rendered,
            serde_json::json!({
                "name": "notes_append",
                "description": "append — dispatched to the @scope/notes plugin. Pass args as key=value strings.",
                "input_schema": variadic_params()
            })
        );
    }

    #[test]
    fn render_tool_schema_name_is_key_underscore_verb_not_plugin_id() {
        // The model-facing name derives from the routing KEY, not the (scoped) id.
        let v = verb("@long/scope/vault", "vault", "read-note");
        let rendered: serde_json::Value =
            serde_json::from_str(&render_tool_schema(&v, "openai")).unwrap();
        assert_eq!(rendered["function"]["name"], "vault_read-note");
    }

    // ---- render_tool_prompt -------------------------------------------------

    #[test]
    fn render_tool_prompt_authored_doc_wins_verbatim() {
        let mut v = verb("@scope/vault", "vault", "search");
        v.doc = Some("Use vault_search to find notes by full-text query.".to_string());
        // A declared schema must NOT override authored prose.
        v.schema = Some(serde_json::json!({ "type": "object" }));

        assert_eq!(
            render_tool_prompt(&v),
            "Use vault_search to find notes by full-text query."
        );
    }

    #[test]
    fn render_tool_prompt_typed_verb_boilerplate_points_at_schema() {
        let mut v = verb("@scope/vault", "vault", "search");
        v.schema = Some(serde_json::json!({ "type": "object" }));

        assert_eq!(
            render_tool_prompt(&v),
            "Tool `vault_search` dispatches to the `@scope/vault` plugin — pass its \
             arguments per the tool's schema. Prefer it over shell/fs for anything the \
             @scope/vault plugin owns."
        );
    }

    #[test]
    fn render_tool_prompt_variadic_verb_boilerplate_points_at_args_strings() {
        let v = verb("@scope/notes", "notes", "append");

        assert_eq!(
            render_tool_prompt(&v),
            "Tool `notes_append` dispatches to the `@scope/notes` plugin — pass its \
             arguments as `args` (key=value strings). Prefer it over shell/fs for \
             anything the @scope/notes plugin owns."
        );
    }

    // ---- resolve_tool -------------------------------------------------------

    #[test]
    fn resolve_tool_finds_verb_by_key_underscore_verb_name() {
        let verbs = vec![
            verb("@scope/vault", "vault", "search"),
            verb("@scope/notes", "notes", "append"),
        ];

        let found = resolve_tool(&verbs, "notes_append").expect("should resolve");
        assert_eq!(found.plugin_id, "@scope/notes");
        assert_eq!(found.verb, "append");
    }

    #[test]
    fn resolve_tool_returns_none_for_unknown_tool_name() {
        let verbs = vec![verb("@scope/vault", "vault", "search")];
        assert!(resolve_tool(&verbs, "vault_missing").is_none());
        // A bare verb without the key prefix does not match either.
        assert!(resolve_tool(&verbs, "search").is_none());
    }

    #[test]
    fn resolve_tool_on_empty_registry_is_none() {
        let verbs: Vec<DispatchableVerb> = Vec::new();
        assert!(resolve_tool(&verbs, "vault_search").is_none());
    }

    #[test]
    fn resolve_verb_schema_finds_the_declared_schema_by_plugin_id_and_verb() {
        let mut search = verb("@scope/vault", "vault", "search");
        let schema = serde_json::json!({
            "type": "object",
            "properties": { "query": { "type": "string" } },
            "required": ["query"]
        });
        search.schema = Some(schema.clone());
        let verbs = vec![search, verb("@scope/notes", "notes", "append")];

        assert_eq!(resolve_verb_schema(&verbs, "@scope/vault", "search"), Some(&schema));
        // A verb with no declared schema (notes:append) resolves to None — nothing to enforce.
        assert!(resolve_verb_schema(&verbs, "@scope/notes", "append").is_none());
        // Unknown verb / unknown plugin resolve to None (the SPI dispatch then fails honestly downstream).
        assert!(resolve_verb_schema(&verbs, "@scope/vault", "missing").is_none());
        assert!(resolve_verb_schema(&verbs, "@scope/other", "search").is_none());
    }

    // ---- validate_tool_input (agent-leg arg parity) -------------------------

    /// A typed schema shaped like the ones `deriveVerbSchemaFromArgs` /
    /// `capabilityToolParameters` emit: a required string arg + an optional integer.
    fn typed_schema() -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": { "type": "string" },
                "limit": { "type": "integer" }
            },
            "required": ["query"]
        })
    }

    #[test]
    fn validate_tool_input_accepts_input_matching_the_declared_schema() {
        let input = serde_json::json!({ "query": "notes", "limit": 5 });
        assert!(validate_tool_input(&typed_schema(), &input).is_ok());
    }

    #[test]
    fn validate_tool_input_accepts_when_only_the_required_arg_is_present() {
        let input = serde_json::json!({ "query": "notes" });
        assert!(validate_tool_input(&typed_schema(), &input).is_ok());
    }

    #[test]
    fn validate_tool_input_rejects_missing_required_arg_and_names_it() {
        let input = serde_json::json!({ "limit": 5 }); // no `query`
        let err = validate_tool_input(&typed_schema(), &input).unwrap_err();
        assert!(err.starts_with("invalid tool input:"), "got: {err}");
        // The message names the offending property, so the model can self-correct.
        assert!(err.contains("query"), "expected the missing field named, got: {err}");
    }

    #[test]
    fn validate_tool_input_rejects_a_wrongly_typed_arg_and_names_it() {
        // `limit` must be an integer; the model sent a string.
        let input = serde_json::json!({ "query": "notes", "limit": "five" });
        let err = validate_tool_input(&typed_schema(), &input).unwrap_err();
        // The JSON-pointer path names the offending field, so the model can self-correct.
        assert!(err.contains("limit"), "expected the field named, got: {err}");
    }

    #[test]
    fn validate_tool_input_rejects_an_enum_violation() {
        let schema = serde_json::json!({
            "type": "object",
            "properties": { "mode": { "type": "string", "enum": ["fast", "slow"] } },
            "required": ["mode"]
        });
        let input = serde_json::json!({ "mode": "sideways" });
        let err = validate_tool_input(&schema, &input).unwrap_err();
        assert!(err.contains("mode"), "expected the field named, got: {err}");
    }

    #[test]
    fn validate_tool_input_fails_open_on_an_uncompilable_schema() {
        // A plugin-authored schema bug (`type` names a nonexistent type) enforces nothing —
        // let the call through rather than wedge the tool on the author's mistake.
        let broken = serde_json::json!({ "type": "banana" });
        let input = serde_json::json!({ "anything": true });
        assert!(validate_tool_input(&broken, &input).is_ok());
    }

    #[test]
    fn validate_tool_input_open_object_schema_accepts_any_object() {
        // The bare `{type:object}` shape enforces only "is an object" — a no-arg/opaque verb.
        let schema = serde_json::json!({ "type": "object" });
        assert!(validate_tool_input(&schema, &serde_json::json!({ "x": 1 })).is_ok());
    }

    #[test]
    fn validate_tool_input_matches_ts_conformance_fixture() {
        // The SAME fixture the TS Ajv validator drives in capabilities-v1's verb-schema-validation.test:
        // one schema (resolved from `expected` by pluginId+verb), the SAME inputs, the SAME per-field
        // verdicts. This proves the Rust host (the agent-tool + plugin→plugin legs) validates identically
        // to every TS surface — the "declare once → validated the same on every surface" invariant made
        // executable across the RS↔TS boundary. Cases are coercion-stable (the fixture's `validationNote`).
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../capabilities-v1/fixtures/plugin-surface-verbs.json"
        ))
        .expect("valid plugin surface verb fixture");

        let expected = fixture["expected"].as_array().expect("expected array");
        let resolve_schema = |plugin_id: &str, verb: &str| -> serde_json::Value {
            expected
                .iter()
                .find(|e| e["pluginId"] == plugin_id && e["verb"] == verb)
                .map(|e| e["schema"].clone())
                .filter(|s| !s.is_null())
                .unwrap_or_else(|| panic!("fixture has no schema for {plugin_id}:{verb}"))
        };

        let entries = fixture["validation"].as_array().expect("validation array");
        assert!(entries.len() >= 2, "expected validation cases in the fixture");
        for entry in entries {
            let plugin_id = entry["pluginId"].as_str().expect("pluginId");
            let verb = entry["verb"].as_str().expect("verb");
            let schema = resolve_schema(plugin_id, verb);
            for case in entry["cases"].as_array().expect("cases array") {
                let input = &case["input"];
                let want_valid = case["valid"].as_bool().expect("valid flag");
                let result = validate_tool_input(&schema, input);
                assert_eq!(
                    result.is_ok(),
                    want_valid,
                    "{plugin_id}:{verb} input {input} — want valid={want_valid}, got {result:?}"
                );
                if !want_valid {
                    let field = case["errorField"]
                        .as_str()
                        .expect("errorField on an invalid case");
                    let err = result.unwrap_err();
                    assert!(
                        err.contains(field),
                        "{plugin_id}:{verb} input {input} — error must name `{field}`, got: {err}"
                    );
                }
            }
        }
    }
}
