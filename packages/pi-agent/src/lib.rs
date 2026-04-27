//! Pi Agent — sovereign AI agent for edge nodes and Raspberry Pi.
//!
//! # Provider selection (env vars)
//!   LLM_PROVIDER=anthropic|openai|groq|mistral|xai|deepseek|together|openrouter|gemini|ollama
//!   LLM_DEFAULT_PROVIDER=<name>            (user's sovereign default, overrides ollama floor)
//!   LLM_MODEL=<model-id>                   (provider-specific default if unset)
//!   LLM_BASE_URL=<url>                     (optional override for any provider)
//!   ANTHROPIC_API_KEY=sk-ant-...
//!   OPENAI_API_KEY=sk-...                  (openai; also fallback for unknown compat providers)
//!   GROQ_API_KEY=gsk_...
//!   MISTRAL_API_KEY=...
//!   XAI_API_KEY=xai-...
//!   DEEPSEEK_API_KEY=sk-...
//!   TOGETHER_API_KEY=...
//!   OPENROUTER_API_KEY=sk-or-...
//!   GEMINI_API_KEY=AIza...
//!   LLM_MAX_CONTEXT_TOKENS=<u32>           (blocks prompts estimated above this size)
//!   LLM_FALLBACK_PROVIDER=<name>           (retried once on primary provider error/budget block)
//!   LLM_BUDGET_<PROVIDER>_USD=<f64>        (rolling 30-day spend cap per provider, e.g. LLM_BUDGET_ANTHROPIC_USD=5.0)
//!   LLM_HISTORY_TURNS=<usize>              (conversational memory depth, default 0 = disabled)
//!   LLM_TOOL_CALL_MAX_ITER=<u32>           (max agentic tool loop iterations, default 5)
//!   LLM_TOOL_OUTPUT_MAX_LINES=<usize>      (truncate tool output fed back to LLM, default unlimited)
//!   LLM_SYSTEM=<string>                    (system prompt override; distros inject persona/role here)
//!                                           pipeline: strip ANSI → dedup repeated lines → truncate
//!
//! Ollama: no key needed; defaults to http://localhost:11434
//!
//! # Pipeline
//!   on-event("user:prompt", prompt)
//!     → guard: LLM_MAX_CONTEXT_TOKENS
//!     → guard: LLM_BUDGET_<PROVIDER>_USD (reads UsageRecord CRDT nodes)
//!     → provider::complete()  — dispatches to Anthropic or OpenAI-compat wire format
//!     → on error/budget block: retry via LLM_FALLBACK_PROVIDER
//!     → store AgentResponse + UsageRecord nodes (triggers reactive CRDT push)

wit_bindgen::generate!({
    world: "pi-agent",
    path: "wit",
});

mod compress;
#[cfg(target_arch = "wasm32")]
mod provider;
#[allow(dead_code)]
mod provider_config;
mod response_nodes;
mod runtime;
mod session;
mod structured_io;
#[cfg(target_arch = "wasm32")]
mod tool_dispatch;
mod tools;
mod utils;

// Re-exports: make submodule items visible at crate root for cross-module use
// (provider.rs calls these via `super::`, tests access them via `use super::*`).
pub(crate) use compress::{compress_tool_output, dedup_lines, strip_ansi};
pub(crate) use provider_config::{choose_model, openai_compat_defaults};
pub(crate) use response_nodes::{
    agent_response_node, usage_record_node, user_prompt_node, AgentResponsePayload,
    UsageRecordPayload,
};
pub(crate) use runtime::react;
#[cfg(target_arch = "wasm32")]
pub(crate) use session::{
    append_to_session, budget_exceeded_for_provider, fork_session, get_or_create_session,
    get_or_create_session_id_readonly, navigate_session, query_history,
};
pub(crate) use session::{
    history_from_nodes, history_from_tree, provider_name_from_env, session_entry_node,
    session_node, sum_provider_spend_usd,
};
pub(crate) use structured_io::{
    apply_edits, detect_format, read_structured_parse, validate_structured,
};
pub(crate) use tools::{tools_anthropic, tools_openai};
pub(crate) use utils::{estimate_usd, fnv1a_hash, new_id, new_pi_urn, now_ns};

use exports::refarm::plugin::integration::{
    Guest as IntegrationGuest, PluginError, PluginMetadata,
};
use refarm::plugin::tractor_bridge;

struct PiAgent;

impl IntegrationGuest for PiAgent {
    fn setup() -> Result<(), PluginError> {
        tractor_bridge::emit_telemetry("pi-agent:ready", None);
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
            name: "pi-agent".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            description: "Sovereign AI agent — runs on edge nodes and Raspberry Pi".to_string(),
            supported_types: vec!["AgentResponse".to_string(), "UserPrompt".to_string()],
            required_capabilities: vec![
                "agent-fs".to_string(),
                "agent-shell".to_string(),
                "llm-bridge".to_string(),
            ],
        }
    }

    fn on_event(event: String, payload: Option<String>) {
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
}

export!(PiAgent);

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
//   A3 — Context opt-in:        LLM_HISTORY_TURNS absent/0 → no CRDT reads for history
//   A4 — Budget opt-out:        no LLM_BUDGET_* → no blocking, feature is truly opt-in
//   A5 — CRDT schema freedom:   any @type stores and queries without prior registration
//        (validated in tractor/src/storage/sqlite.rs::store_and_query_node)

#[cfg(test)]
mod extensibility_contract;
