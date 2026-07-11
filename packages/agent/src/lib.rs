//! Refarm Agent — sovereign AI agent for edge nodes and local runtimes.
//!
//! # Provider selection (env vars)
//!   MODEL_PROVIDER=anthropic|openai|openai-codex|github-copilot|groq|mistral|xai|deepseek|together|openrouter|gemini|ollama
//!   MODEL_DEFAULT_PROVIDER=<name>            (user's sovereign default, overrides ollama floor)
//!   MODEL_ID=<model-id>                      (provider-specific default if unset)
//!   MODEL_BASE_URL=<url>                     (optional override for any provider)
//!   ANTHROPIC_API_KEY=sk-ant-...
//!   OPENAI_API_KEY=sk-...                    (openai; also fallback for unknown compat providers)
//!   OPENAI_CODEX_ACCESS_TOKEN=ey...           (openai-codex subscription token)
//!   GITHUB_COPILOT_ACCESS_TOKEN=gho_...      (github-copilot subscription token)
//!   GROQ_API_KEY=gsk_...
//!   MISTRAL_API_KEY=...
//!   XAI_API_KEY=xai-...
//!   DEEPSEEK_API_KEY=sk-...
//!   TOGETHER_API_KEY=...
//!   OPENROUTER_API_KEY=sk-or-...
//!   GEMINI_API_KEY=AIza...
//!   MODEL_MAX_CONTEXT_TOKENS=<u32>           (blocks prompts estimated above this size)
//!   MODEL_FALLBACK_PROVIDER=<name>           (retried once on primary provider error/budget block)
//!   MODEL_FALLBACK_MODEL_ID=<model-id>       (optional model override for MODEL_FALLBACK_PROVIDER)
//!   MODEL_BUDGET_<PROVIDER>_USD=<f64>        (rolling 30-day spend cap per provider, e.g. MODEL_BUDGET_ANTHROPIC_USD=5.0)
//!   MODEL_HISTORY_TURNS=<usize>              (conversational memory depth, default 0 = disabled)
//!   MODEL_TOOL_CALL_MAX_ITER=<u32>           (max agentic tool loop iterations, default 5)
//!   MODEL_TOOL_OUTPUT_MAX_LINES=<usize>      (truncate tool output fed back to LLM, default unlimited)
//!   MODEL_STREAM_RESPONSES=0|false|no|off    (opt OUT of streaming; on by default — incremental partials)
//!   MODEL_SYSTEM=<string>                    (system prompt override; distros inject persona/role here)
//!                                             pipeline: strip ANSI → dedup repeated lines → truncate
//!
//! Ollama: no key needed; defaults to http://localhost:11434
//!
//! # Pipeline
//!   on-event("user:prompt", prompt)
//!     → guard: MODEL_MAX_CONTEXT_TOKENS
//!     → guard: MODEL_BUDGET_<PROVIDER>_USD (reads UsageRecord CRDT nodes)
//!     → provider::complete()  — dispatches to Anthropic or OpenAI-compat wire format
//!     → on error/budget block: retry via MODEL_FALLBACK_PROVIDER
//!     → store AgentResponse + UsageRecord nodes (triggers reactive CRDT push)

wit_bindgen::generate!({
    world: "effect-capable",
    path: "../plugin-wit/wit",
});

// The emit fns fire only on wasm (the host telemetry import), while the pure payload
// shapers are exercised by native tests — so on a native build several items read as
// unused. Same cfg-split shape as the provider modules below.
#[allow(dead_code)]
mod agent_events;
mod compress;
#[cfg(target_arch = "wasm32")]
mod provider;
#[cfg(target_arch = "wasm32")]
mod provider_anthropic;
#[allow(dead_code)]
mod provider_config;
#[cfg(target_arch = "wasm32")]
mod provider_openai_compat;
mod provider_runtime;
mod response_nodes;
mod runtime;
mod session;
mod streaming_chunks;
mod streaming_config;
mod structured_io;
#[cfg(target_arch = "wasm32")]
mod tool_dispatch;
mod tools;
mod utils;

// Re-exports: make submodule items visible at crate root for cross-module use
// (provider.rs calls these via `super::`, tests access them via `use super::*`).
#[allow(unused_imports)]
pub(crate) use compress::{compress_tool_output, dedup_lines, strip_ansi};
#[allow(unused_imports)]
pub(crate) use runtime::react;
#[cfg(target_arch = "wasm32")]
pub(crate) use session::{
    append_to_session, budget_exceeded_for_provider, get_or_create_session, query_history,
    record_context_fold,
};
#[allow(unused_imports)]
pub(crate) use session::{
    compact_history, compact_history_detailed, history_from_nodes, history_from_tree,
    provider_name_from_env, session_entry_node, session_node, session_participant_from_agent_id,
    sum_provider_spend_usd,
};
#[allow(unused_imports)]
pub(crate) use structured_io::{
    apply_edits, detect_format, read_structured_parse, validate_structured,
};
#[allow(unused_imports)]
pub(crate) use utils::{
    estimate_billable_usd, estimate_usd, fnv1a_hash, new_id, mint_urn, now_ns,
    pricing_mode_for_provider,
};

#[cfg(test)]
pub(crate) use provider_config::{choose_model, openai_compat_defaults, ANTHROPIC_DEFAULT_MODEL};
#[cfg(test)]
pub(crate) use response_nodes::{
    agent_response_node, usage_record_node, user_prompt_node, AgentResponsePayload,
    UsageRecordPayload,
};
#[cfg(test)]
pub(crate) use tools::{tools_anthropic, tools_openai};

use exports::plugin::host::integration::{
    Guest as IntegrationGuest, PluginError, PluginMetadata,
};
use plugin::host::tractor_bridge;

struct Agent;

// ── Delegation: the agent as a dispatchable sub-agent ─────────────────────────
//
// The manifest's `verbs` block (key "agent", verb "respond") makes `agent:respond`
// a DISPATCHABLE verb: the host derives an `agent:dispatch` channel, surfaces
// `agent_respond` as a model tool to every OTHER agent, and routes an invocation
// here as an `agent:dispatch` EVENT carrying `{ verb, replyRef, ...args }`. This
// mirrors the lsp-code-ops dispatch handler exactly — one call protocol
// (`dispatch_to_plugin`) shared by `invoke_tool` (agent leg) and `call_plugin`
// (cross-plugin leg). The correlation is out-of-band: we run the verb and store a
// `DispatchResult` node keyed by `replyRef`, which the caller's await polls for.
// So agent-A delegating to agent-B is `invoke_tool("agent_respond", {prompt})` →
// this handler runs a full sub-agent turn in THIS instance → result flows back.

/// The dispatch routing key — MUST match `capabilities.verbs.key` in plugin.json.
const DISPATCH_KEY: &str = "agent";
/// The node `@type` a dispatched verb stores its result under, and the correlation
/// field the host awaits — the convention shared with lsp-code-ops + the
/// `@refarm.dev/dispatch-result-contract-v1` TS contract.
const DISPATCH_RESULT_TYPE: &str = "DispatchResult";
const REPLY_REF_FIELD: &str = "replyRef";
const RESULT_FIELD: &str = "result";

struct DispatchRequest {
    verb: String,
    reply_ref: String,
    /// The verb's args = the dispatch payload minus the `verb`/`replyRef` envelope.
    args: serde_json::Value,
}

/// Parse an `agent:dispatch` payload into a `DispatchRequest`. Returns None when the
/// payload is not the expected `{ verb, replyRef, ... }` object (a malformed dispatch
/// is ignored, never stored). PURE — mirrors lsp-code-ops `parse_dispatch`.
fn parse_agent_dispatch(payload: &str) -> Option<DispatchRequest> {
    let value: serde_json::Value = serde_json::from_str(payload).ok()?;
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
        args: serde_json::Value::Object(args),
    })
}

/// Build the `DispatchResult` node the host awaits: the correlation key plus the
/// verb's result payload (`result` is any JSON — the sub-agent's response object on
/// success, an `{ error }` object on failure). PURE — mirrors lsp-code-ops
/// `build_dispatch_result_node`, so both plugins produce the identical node shape.
fn build_dispatch_result_node(reply_ref: &str, result: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "@id": format!("urn:sovereign:dispatch-result:{reply_ref}"),
        "@type": DISPATCH_RESULT_TYPE,
        REPLY_REF_FIELD: reply_ref,
        RESULT_FIELD: result,
    })
}

/// An error result payload for a dispatched verb: `{ error: <message> }`. The agent
/// ALWAYS stores a result node (even on failure) so the caller's await never hangs.
/// PURE.
fn dispatch_error_result(message: &str) -> serde_json::Value {
    serde_json::json!({ "error": message })
}

/// Run a dispatched verb, returning the agent-facing result VALUE (an error result on
/// any failure — never propagates, so a result node is always stored). Today the only
/// dispatchable verb is `respond` (delegate a sub-agent turn); an unknown verb is an
/// error result. Splitting the run from the store keeps this pure + unit-testable.
#[cfg(target_arch = "wasm32")]
fn run_dispatched_verb(verb: &str, args: &serde_json::Value) -> serde_json::Value {
    if verb != "respond" {
        return dispatch_error_result(&format!("unknown verb: {verb}"));
    }
    // The args ARE the respond payload ({ prompt, system?, session_id?, ... }).
    let payload = args.to_string();
    let req = match parse_respond_payload(&payload) {
        Ok(req) => req,
        Err(e) => return dispatch_error_result(&format!("{e:?}")),
    };
    match execute_respond(&req) {
        // respond returns a JSON string ({content, model, usage}); surface it as
        // parsed JSON so the caller gets structured data, not a stringified blob.
        Ok(json) => serde_json::from_str::<serde_json::Value>(&json)
            .unwrap_or_else(|_| serde_json::json!({ "content": json })),
        Err(e) => dispatch_error_result(&format!("{e:?}")),
    }
}

struct RespondPayload {
    prompt: String,
    system: Option<String>,
    session_id: Option<String>,
    history_turns: Option<usize>,
    provider: Option<String>,
    model: Option<String>,
}

/// RAII guard: sets an env var for the duration of a call, restores on drop.
/// Ensures env vars are always restored even if the callee panics.
pub(crate) struct EnvGuard {
    key: &'static str,
    prev: Option<String>,
}

impl EnvGuard {
    fn maybe_set(key: &'static str, value: Option<&str>) -> Option<Self> {
        value.map(|v| {
            let prev = std::env::var(key).ok();
            std::env::set_var(key, v);
            Self { key, prev }
        })
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match self.prev.take() {
            Some(v) => std::env::set_var(self.key, v),
            None => std::env::remove_var(self.key),
        }
    }
}

fn parse_respond_payload(payload: &str) -> Result<RespondPayload, PluginError> {
    let trimmed = payload.trim();
    if trimmed.is_empty() {
        return Err(PluginError::InvalidSchema(
            "respond payload must not be empty".to_string(),
        ));
    }

    let parsed = serde_json::from_str::<serde_json::Value>(trimmed).map_err(|e| {
        PluginError::InvalidSchema(format!("respond payload must be valid JSON: {e}"))
    })?;
    let prompt = parsed
        .get("prompt")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            PluginError::InvalidSchema(
                "respond payload requires non-empty string field `prompt`".to_string(),
            )
        })?
        .to_string();
    let system = parsed
        .get("system")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let session_id = parsed
        .get("session_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let history_turns = parsed
        .get("history_turns")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize);
    let provider = parsed
        .get("provider")
        .and_then(|v| v.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let model = parsed
        .get("model")
        .and_then(|v| v.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    Ok(RespondPayload {
        prompt,
        system,
        session_id,
        history_turns,
        provider,
        model,
    })
}

fn build_respond_json(
    content: String,
    model: String,
    provider: String,
    tokens_in: u32,
    tokens_out: u32,
    tokens_reasoning: u32,
    estimated_usd: f64,
    usage_raw: String,
) -> String {
    let usage_details =
        serde_json::from_str::<serde_json::Value>(&usage_raw).unwrap_or(serde_json::json!({}));
    let pricing_mode = pricing_mode_for_provider(&provider);
    serde_json::json!({
        "content": content,
        "model": model,
        "provider": provider,
        "usage": {
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "tokens_reasoning": tokens_reasoning,
            "pricing_mode": pricing_mode,
            "estimated_usd": estimated_usd,
            "raw": usage_details,
        }
    })
    .to_string()
}

#[cfg(target_arch = "wasm32")]
fn execute_respond(req: &RespondPayload) -> Result<String, PluginError> {
    let turns_str = req.history_turns.map(|n| n.to_string());
    let _session = EnvGuard::maybe_set("MODEL_SESSION_ID", req.session_id.as_deref());
    let _turns = EnvGuard::maybe_set("MODEL_HISTORY_TURNS", turns_str.as_deref());

    let outcome = runtime::execute_prompt_with_route(
        &req.prompt,
        req.system.as_deref(),
        None,
        req.provider.as_deref(),
        req.model.as_deref(),
    )
    .ok_or_else(|| {
        PluginError::Internal("failed to persist prompt context before respond".to_string())
    })?;
    let estimated_usd = estimate_billable_usd(
        &outcome.provider,
        &outcome.model,
        outcome.tokens_in,
        outcome.tokens_out,
        outcome.tokens_cached,
    );
    Ok(build_respond_json(
        outcome.content,
        outcome.model,
        outcome.provider,
        outcome.tokens_in,
        outcome.tokens_out,
        outcome.tokens_reasoning,
        estimated_usd,
        outcome.usage_raw,
    ))
}

#[cfg(not(target_arch = "wasm32"))]
fn execute_respond(req: &RespondPayload) -> Result<String, PluginError> {
    let turns_str = req.history_turns.map(|n| n.to_string());
    let _provider = EnvGuard::maybe_set("MODEL_PROVIDER", req.provider.as_deref());
    let _model = EnvGuard::maybe_set("MODEL_ID", req.model.as_deref());
    let _system = EnvGuard::maybe_set("MODEL_SYSTEM", req.system.as_deref());
    let _session = EnvGuard::maybe_set("MODEL_SESSION_ID", req.session_id.as_deref());
    let _turns = EnvGuard::maybe_set("MODEL_HISTORY_TURNS", turns_str.as_deref());

    let (
        content,
        _tool_calls,
        tokens_in,
        tokens_out,
        tokens_cached,
        tokens_reasoning,
        model,
        usage_raw,
    ) = runtime::react_with_prompt_ref(&req.prompt, None);
    let provider = provider_name_from_env().to_string();
    let estimated_usd =
        estimate_billable_usd(&provider, &model, tokens_in, tokens_out, tokens_cached);
    Ok(build_respond_json(
        content,
        model,
        provider,
        tokens_in,
        tokens_out,
        tokens_reasoning,
        estimated_usd,
        usage_raw,
    ))
}

impl IntegrationGuest for Agent {
    fn setup() -> Result<(), PluginError> {
        tractor_bridge::emit_telemetry("agent:ready", None);
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
            name: "agent".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            description: "Sovereign AI agent — runs on edge nodes and Raspberry Pi".to_string(),
            supported_types: vec!["Response".to_string(), "UserPrompt".to_string()],
            required_capabilities: vec![
                "host-fs".to_string(),
                "host-shell".to_string(),
                "model-bridge".to_string(),
            ],
        }
    }

    fn on_event(event: String, payload: Option<String>) {
        // The delegation channel: another agent (or plugin) invoked `agent_respond`,
        // routed here as `agent:dispatch` with `{ verb, replyRef, ...args }`. Run the
        // sub-agent turn and store a `DispatchResult` node the caller's await polls for.
        if event == format!("{DISPATCH_KEY}:dispatch") {
            let Some(payload) = payload else { return };
            let Some(req) = parse_agent_dispatch(&payload) else {
                return;
            };
            #[cfg(target_arch = "wasm32")]
            {
                let result = run_dispatched_verb(&req.verb, &req.args);
                let node = build_dispatch_result_node(&req.reply_ref, result);
                let _ = tractor_bridge::store_node(&node.to_string());
            }
            #[cfg(not(target_arch = "wasm32"))]
            let _ = &req;
            return;
        }
        if event != "user:prompt" {
            return;
        }
        let Some(prompt) = payload else {
            return;
        };
        #[cfg(target_arch = "wasm32")]
        runtime::handle_prompt(prompt);
        #[cfg(not(target_arch = "wasm32"))]
        let _ = prompt;
    }

    fn respond(payload: String) -> Result<String, PluginError> {
        let req = parse_respond_payload(&payload)?;
        execute_respond(&req)
    }
}

export!(Agent);

// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests;

// ── Extensibility contract ─────────────────────────────────────────────────────
//
// These tests are NOT about implementation — they are axioms.
// If any fails, a extensibility guarantee was broken.
// New features must not violate these axioms; new axioms must have a test.
//
//   A1 — Provider agnosticism:  any unknown name → OpenAI compat, zero code changes
//   A2 — Zero-config boot:      no env vars → agent responds, no panic
//   A3 — Context opt-in:        MODEL_HISTORY_TURNS absent/0 → no CRDT reads for history
//   A4 — Budget opt-out:        no MODEL_BUDGET_* → no blocking, feature is truly opt-in
//   A5 — CRDT schema freedom:   any @type stores and queries without prior registration
//        (validated in tractor/src/storage/sqlite.rs::store_and_query_node)

#[cfg(test)]
mod extensibility_contract;
