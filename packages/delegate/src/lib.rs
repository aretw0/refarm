//! delegate — agent-delegation ergonomics as a plugin.
//!
//! The agent's `respond` verb already runs a full sub-agent turn (its own fresh instance
//! + session) and accepts a `system` prompt (the persona) and `model`. This plugin adds
//! the ERGONOMICS on top, WITHOUT the agent depending on it — a second instance of the
//! lsp-code-ops pattern (a plugin that EXTENDS the agent via `call_plugin`).
//!
//! It surfaces two model tools (verb `<key>_<verb>`):
//!   - `delegate_single` — run ONE task under a named persona.
//!   - `delegate_chain`  — run a PIPELINE of persona steps, threading each output forward.
//!
//! Both are implemented by calling the agent's `respond` verb via `call_plugin`
//! (cross-plugin: delegate → agent, the normal event→runner dispatch), sequentially. The
//! dispatch delivery + correlation is the SAME `<key>:dispatch` → `DispatchResult`
//! protocol every plugin uses, so a caller correlates the result the same way.
//!
//! PERSONAS are sovereign `AgentPersona` graph nodes ({name, description, system, model?}).
//! Defaults (scout/planner/worker/reviewer) are seeded on `setup` if absent, and read at
//! dispatch time via `query_nodes` — so a user can author more personas by storing more
//! `AgentPersona` nodes, no recompile.
//!
//! call_plugin is BLOCKING per call, and the runner is single-threaded, so a chain of N
//! steps is N strictly-sequential sub-turns. That is why `parallel` mode is intentionally
//! absent from this slice (true concurrency needs host support).

use serde_json::{json, Value};

/// The API the agent advertises (`providesApi: ["AgentRespond"]`). The delegate discovers
/// the agent by this API via `get_plugin_api` rather than hardcoding its id — so it finds
/// the agent whatever its registered runtime id is (the same call-through pattern the vault
/// plugin uses to find the quality provider).
const AGENT_RESPOND_API: &str = "AgentRespond";
/// The verb on the discovered agent that runs a sub-turn.
const AGENT_RESPOND_VERB: &str = "respond";

/// The graph `@type` personas are stored under, and how many to read at most.
const PERSONA_NODE_TYPE: &str = "AgentPersona";
const PERSONA_QUERY_LIMIT: u32 = 128;

/// The dispatch envelope + result contract — shared with lsp-code-ops + the agent, so a
/// caller sees an identical `DispatchResult` shape whatever verb ran.
const DISPATCH_RESULT_TYPE: &str = "DispatchResult";
const REPLY_REF_FIELD: &str = "replyRef";
const RESULT_FIELD: &str = "result";
const DISPATCH_KEY: &str = "delegate";

/// A parsed dispatch request: `{ verb, replyRef, ...args }` off the `delegate:dispatch`
/// event. `args` is the verb's input (the tool call's JSON), envelope fields removed.
struct DispatchRequest {
    verb: String,
    reply_ref: String,
    args: Value,
}

/// Parse a `delegate:dispatch` payload into a `DispatchRequest` (None if malformed — a
/// malformed dispatch is ignored, never stored). Mirrors lsp-code-ops `parse_dispatch`.
fn parse_dispatch(payload: &str) -> Option<DispatchRequest> {
    let value: Value = serde_json::from_str(payload).ok()?;
    let obj = value.as_object()?;
    let verb = obj.get("verb")?.as_str()?.to_string();
    let reply_ref = obj.get("replyRef")?.as_str()?.to_string();
    let mut args = serde_json::Map::new();
    for (k, v) in obj {
        if k != "verb" && k != "replyRef" {
            args.insert(k.clone(), v.clone());
        }
    }
    Some(DispatchRequest {
        verb,
        reply_ref,
        args: Value::Object(args),
    })
}

/// Build the `DispatchResult` node the host awaits — the correlation key + the verb's
/// result. Identical shape to lsp-code-ops + the agent, so callers are uniform.
fn build_dispatch_result_node(reply_ref: &str, result: Value) -> Value {
    json!({
        "@id": format!("urn:sovereign:dispatch-result:{reply_ref}"),
        "@type": DISPATCH_RESULT_TYPE,
        REPLY_REF_FIELD: reply_ref,
        RESULT_FIELD: result,
    })
}

/// An error result payload for a delegated verb: `{ error: <message> }`. The plugin
/// ALWAYS stores a result node (even on failure) so a caller's await never hangs.
fn error_result(message: &str) -> Value {
    json!({ "error": message })
}

/// The four default personas the delegate seeds on setup — the scout→planner→worker→
/// reviewer vocabulary (mirrors pi's sample agents). Each is an `AgentPersona` node:
/// `{ @type, @id, name, description, system, model? }`. `system` IS the persona — it
/// becomes the sub-agent's system prompt; `model` is optional (agent default otherwise).
fn default_personas() -> Vec<Value> {
    fn persona(name: &str, description: &str, system: &str) -> Value {
        json!({
            "@type": PERSONA_NODE_TYPE,
            "@id": format!("urn:sovereign:agent-persona:{name}"),
            "name": name,
            "description": description,
            "system": system,
        })
    }
    vec![
        persona(
            "scout",
            "Fast recon. Explores and returns a compact, high-signal summary of what it found — no changes.",
            "You are a scout sub-agent. Work fast and read-only. Explore the task's surface and return a COMPACT, high-signal summary of what you found — key facts, locations, and unknowns. Do not make changes. Prefer bullet points over prose.",
        ),
        persona(
            "planner",
            "Turns a task (and any scout findings) into a concrete, ordered implementation plan.",
            "You are a planner sub-agent. Given a task and any prior findings, produce a CONCRETE, ordered plan: the steps to take, the files/areas each touches, and the risks. Do not implement — plan. Be specific enough that a worker can execute it without guessing.",
        ),
        persona(
            "worker",
            "General-purpose executor. Carries out the task (or plan) end to end with full capabilities.",
            "You are a worker sub-agent with full capabilities, operating in an isolated context. Carry out the assigned task (or plan) end to end. When done, state what you did and any files changed. If you hand off to a reviewer, list the exact paths and key functions touched.",
        ),
        persona(
            "reviewer",
            "Reviews work for correctness, risks, and gaps; returns findings, not changes.",
            "You are a reviewer sub-agent. Review the described work for correctness, risks, and gaps. Return your findings as a short, prioritized list (most severe first). Do not make changes — surface what a human or a follow-up worker should address.",
        ),
    ]
}

/// Resolve a persona name to its `(system, model)` from the queried persona nodes. Returns
/// `(None, None)` when the name is absent or empty (→ the agent runs its DEFAULT persona,
/// i.e. respond with no system/model override). PURE — the caller supplies the nodes.
fn resolve_persona(personas: &[Value], name: Option<&str>) -> (Option<String>, Option<String>) {
    let Some(name) = name.map(str::trim).filter(|s| !s.is_empty()) else {
        return (None, None);
    };
    for node in personas {
        if node.get("name").and_then(Value::as_str) == Some(name) {
            let system = node
                .get("system")
                .and_then(Value::as_str)
                .map(|s| s.to_string());
            let model = node
                .get("model")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.to_string());
            return (system, model);
        }
    }
    // An unknown persona name is not an error — fall back to the agent default, so a
    // slightly-off name still runs rather than failing the whole delegation.
    (None, None)
}

/// Thread a prior step's output into the next step's task: substitute every `{previous}`
/// marker, or — when the task has no marker — append the prior output as trailing context.
/// The first step (no previous) returns the task unchanged. PURE.
fn thread_previous(task: &str, previous: Option<&str>) -> String {
    let Some(prev) = previous else {
        return task.to_string();
    };
    if task.contains("{previous}") {
        task.replace("{previous}", prev)
    } else {
        format!("{task}\n\n--- Previous step output ---\n{prev}")
    }
}

/// Build the JSON input for the agent's `respond` verb: the prompt plus the persona's
/// system/model overrides (each omitted when None, so respond uses its own default).
/// session_id is intentionally omitted so each sub-turn gets a FRESH session. PURE.
fn respond_input(prompt: &str, system: Option<&str>, model: Option<&str>) -> Value {
    let mut input = serde_json::Map::new();
    input.insert("prompt".into(), json!(prompt));
    if let Some(system) = system {
        input.insert("system".into(), json!(system));
    }
    if let Some(model) = model {
        input.insert("model".into(), json!(model));
    }
    Value::Object(input)
}

/// Pull the sub-agent's answer text out of what `call_plugin` returns. The agent's respond
/// result comes back as a `DispatchResult` node (`{ @type, replyRef, result: { content,
/// … } }`), so the content is at `result.content`. Falls back to the whole string if the
/// shape is unexpected (never panics — a chain must keep flowing or fail cleanly). PURE.
fn extract_content(dispatch_result_json: &str) -> String {
    let Ok(value) = serde_json::from_str::<Value>(dispatch_result_json) else {
        return dispatch_result_json.to_string();
    };
    // Unwrap the DispatchResult envelope if present, else treat the value as the result.
    let result = value.get(RESULT_FIELD).unwrap_or(&value);
    if let Some(content) = result.get("content").and_then(Value::as_str) {
        return content.to_string();
    }
    // No content field → surface the result object as a string so the next step sees it.
    result.to_string()
}

#[cfg(test)]
mod tests;

// ── wasm guest ────────────────────────────────────────────────────────────────
// The WIT bindings are generated INLINE by the macro (like lsp-code-ops) — NOT a
// checked-in file — so wit-bindgen wires its own `wit_bindgen_rt` runtime linkage.
#[cfg(target_arch = "wasm32")]
#[allow(warnings)]
mod bindings {
    wit_bindgen::generate!({
        path: "../plugin-wit/wit",
        world: "plugin",
    });
}

#[cfg(target_arch = "wasm32")]
mod guest {
    use super::*;
    use bindings::exports::plugin::host::integration::{
        Guest as IntegrationGuest, PluginError, PluginMetadata,
    };
    use bindings::plugin::host::tractor_bridge;

    struct Delegate;

    /// Read the persona nodes from the graph (empty vec on any query error — the delegate
    /// then falls every persona back to the agent default rather than failing).
    fn load_personas() -> Vec<Value> {
        let Ok(rows) = tractor_bridge::query_nodes(PERSONA_NODE_TYPE, PERSONA_QUERY_LIMIT) else {
            return Vec::new();
        };
        rows.iter()
            .filter_map(|s| serde_json::from_str::<Value>(s).ok())
            .collect()
    }

    /// Run ONE delegated task under a persona: resolve the persona → call the agent's
    /// `respond` → return the sub-agent's content (or an error result value). Never panics.
    fn run_single(personas: &[Value], persona: Option<&str>, task: &str) -> Value {
        // Discover the agent by its advertised API — id-agnostic (works whatever the
        // agent's runtime id is). Absent → no agent loaded to delegate to.
        let agent_id = match tractor_bridge::get_plugin_api(&AGENT_RESPOND_API.to_string()) {
            Ok(id) => id,
            Err(_) => {
                return error_result(
                    "no agent is loaded to delegate to (no plugin provides the AgentRespond API)",
                )
            }
        };
        let (system, model) = resolve_persona(personas, persona);
        let input = respond_input(task, system.as_deref(), model.as_deref());
        // The macro-generated binding takes owned `String`s.
        match tractor_bridge::call_plugin(
            &agent_id,
            &AGENT_RESPOND_VERB.to_string(),
            &input.to_string(),
        ) {
            Ok(dispatch_result) => json!({ "content": extract_content(&dispatch_result) }),
            Err(e) => error_result(&format!("delegation to the agent failed: {e:?}")),
        }
    }

    /// Run a CHAIN of steps sequentially, threading each output into the next task. Returns
    /// the final step's result; aborts (returns the error result) at the first failed step.
    fn run_chain(personas: &[Value], steps: &[Value]) -> Value {
        if steps.is_empty() {
            return error_result("chain requires at least one step");
        }
        let mut previous: Option<String> = None;
        let mut last = error_result("chain produced no steps");
        for step in steps {
            let persona = step.get("persona").and_then(Value::as_str);
            let Some(task) = step.get("task").and_then(Value::as_str) else {
                return error_result("each chain step requires a `task`");
            };
            let threaded = thread_previous(task, previous.as_deref());
            let result = run_single(personas, persona, &threaded);
            // A failed step aborts the chain (its error result is returned).
            if result.get("error").is_some() {
                return result;
            }
            previous = result
                .get("content")
                .and_then(Value::as_str)
                .map(|s| s.to_string());
            last = result;
        }
        last
    }

    /// Dispatch a delegate verb, returning the agent-facing result VALUE (an error result
    /// on any failure — never propagates, so a result node is always stored).
    fn run_verb(verb: &str, args: &Value) -> Value {
        let personas = load_personas();
        match verb {
            "single" => {
                let persona = args.get("persona").and_then(Value::as_str);
                let Some(task) = args.get("task").and_then(Value::as_str) else {
                    return error_result("delegate:single requires a `task`");
                };
                run_single(&personas, persona, task)
            }
            "chain" => {
                let Some(steps) = args.get("steps").and_then(Value::as_array) else {
                    return error_result("delegate:chain requires a `steps` array");
                };
                run_chain(&personas, steps)
            }
            other => error_result(&format!("unknown delegate verb: {other}")),
        }
    }

    impl IntegrationGuest for Delegate {
        fn setup() -> Result<(), PluginError> {
            // Seed the default personas as AgentPersona nodes IF they are not already
            // present — so the delegate ships usable personas out of the box, but never
            // clobbers a user's authored/edited persona of the same id. Idempotent.
            let existing = load_personas();
            for persona in default_personas() {
                let id = persona.get("@id").and_then(Value::as_str).unwrap_or("");
                let present = existing
                    .iter()
                    .any(|p| p.get("@id").and_then(Value::as_str) == Some(id));
                if !present {
                    let _ = tractor_bridge::store_node(&persona.to_string());
                }
            }
            tractor_bridge::emit_telemetry("delegate:ready", None);
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
                name: "delegate".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                description: "Agent-delegation ergonomics: single + chain persona pipelines over the agent's respond".to_string(),
                supported_types: vec![
                    "DispatchResult".to_string(),
                    "AgentPersona".to_string(),
                ],
                required_capabilities: vec!["tractor-bridge".to_string()],
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
                "delegate is dispatch-only; it does not respond".to_string(),
            ))
        }
    }

    bindings::export!(Delegate with_types_in bindings);
}
