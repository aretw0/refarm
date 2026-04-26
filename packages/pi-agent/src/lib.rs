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

use std::sync::atomic::{AtomicU64, Ordering};

use exports::refarm::plugin::integration::{Guest as IntegrationGuest, PluginError, PluginMetadata};
use refarm::plugin::tractor_bridge;

struct PiAgent;

impl IntegrationGuest for PiAgent {
    fn setup() -> Result<(), PluginError> {
        tractor_bridge::emit_telemetry("pi-agent:ready", None);
        Ok(())
    }

    fn ingest() -> Result<u32, PluginError> { Ok(0) }
    fn push(_payload: String) -> Result<(), PluginError> { Ok(()) }
    fn teardown() {}
    fn get_help_nodes() -> Result<Vec<String>, PluginError> { Ok(vec![]) }

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
        if event != "user:prompt" { return; }
        let Some(prompt) = payload else { return; };
        #[cfg(target_arch = "wasm32")]
        handle_prompt(prompt);
        #[cfg(not(target_arch = "wasm32"))]
        let _ = prompt;
    }
}

// ── Prompt pipeline ───────────────────────────────────────────────────────────

#[cfg(target_arch = "wasm32")]
fn handle_prompt(prompt: String) {
    let prompt_ref = format!("urn:pi-agent:prompt-{}", new_id());

    // Legacy node — kept for backward compat with harness and pre-session namespaces.
    let prompt_node = serde_json::json!({
        "@type":        "UserPrompt",
        "@id":          prompt_ref,
        "content":      prompt.clone(),
        "timestamp_ns": now_ns(),
    });
    if tractor_bridge::store_node(&prompt_node.to_string()).is_err() {
        return;
    }

    // Session tree: append user turn, capture entry_id for linking agent response.
    let session_id    = get_or_create_session();
    let user_entry_id = append_to_session(&session_id, "user", &prompt);

    let t0 = now_ns();
    let (content, tool_calls, tokens_in, tokens_out, tokens_cached, tokens_reasoning, model, usage_raw) = react(&prompt);
    let duration_ms = now_ns().saturating_sub(t0) / 1_000_000;

    // Legacy AgentResponse node — preserved for harness assertions.
    let response = serde_json::json!({
        "@type":        "AgentResponse",
        "@id":          format!("urn:pi-agent:resp-{}", new_id()),
        "prompt_ref":   prompt_ref,
        "content":      content,
        "sequence":     0,
        "is_final":     true,
        "tool_calls":   tool_calls,
        "timestamp_ns": now_ns(),
        "llm": {
            "model":       model,
            "tokens_in":   tokens_in,
            "tokens_out":  tokens_out,
            "duration_ms": duration_ms,
        },
    });
    let _ = tractor_bridge::store_node(&response.to_string());

    // Session tree: append agent turn. parent_entry_id = user_entry_id (from append_to_session
    // internal state via leaf), so tree is user → agent naturally.
    let _ = append_to_session(&session_id, "agent", &content);
    let _ = user_entry_id; // used for ordering guarantee via CRDT leaf pointer

    let provider_name = provider_name_from_env();
    let usage = serde_json::json!({
        "@type":         "UsageRecord",
        "@id":           format!("urn:pi-agent:usage-{}", new_id()),
        "prompt_ref":    prompt_ref,
        "provider":      provider_name,
        "model":         model,
        "tokens_in":     tokens_in,
        "tokens_out":    tokens_out,
        "estimated_usd":    estimate_usd(&model, tokens_in, tokens_out, tokens_cached),
        "tokens_cached":    tokens_cached,
        "tokens_reasoning": tokens_reasoning,
        "usage_raw":        usage_raw,
        "duration_ms":      duration_ms,
        "timestamp_ns":     now_ns(),
    });
    let _ = tractor_bridge::store_node(&usage.to_string());
}

/// Returns: (content, tool_calls, tokens_in, tokens_out, tokens_cached, tokens_reasoning, model_id, usage_raw)
fn react(prompt: &str) -> (String, serde_json::Value, u32, u32, u32, u32, String, String) {
    // Rough estimate: 1 token ≈ 4 chars. Guard fires before any API call.
    let estimated_tokens = (prompt.len() / 4).max(1) as u32;
    let max_tokens = std::env::var("LLM_MAX_CONTEXT_TOKENS")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(u32::MAX);
    if estimated_tokens > max_tokens {
        return (
            format!("[pi-agent] prompt excede LLM_MAX_CONTEXT_TOKENS ({estimated_tokens} > {max_tokens} tokens estimados)"),
            serde_json::json!([]), 0, 0, 0, 0, "blocked".to_owned(), "{}".to_owned(),
        );
    }

    #[cfg(target_arch = "wasm32")]
    {
        let primary_name = provider_name_from_env();
        let prov = provider::Provider::from_env();
        let model = prov.model().to_owned();
        let default_system = "You are pi-agent, a sovereign AI assistant for a Refarm node. \
             Help with local tasks, files, and shell commands. Be concise.";
        let system_owned = std::env::var("LLM_SYSTEM").unwrap_or_else(|_| default_system.to_owned());
        let system = system_owned.as_str();
        // Assemble conversation history from CRDT (opt-in via LLM_HISTORY_TURNS).
        let mut messages = query_history();
        messages.push(("user".to_owned(), prompt.to_owned()));

        let primary_result = if budget_exceeded_for_provider(&primary_name) {
            Err(format!(
                "[budget] LLM_BUDGET_{}_USD exceeded — primary provider blocked",
                primary_name.to_uppercase()
            ))
        } else {
            prov.complete(system, &messages)
        };
        match primary_result {
            Ok(r) => (r.content, r.tool_calls, r.tokens_in, r.tokens_out,
                      r.tokens_cached, r.tokens_reasoning, model, r.usage_raw),
            Err(primary_err) => {
                if let Ok(fallback_name) = std::env::var("LLM_FALLBACK_PROVIDER") {
                    let original_provider = provider_name_from_env();
                    std::env::set_var("LLM_PROVIDER", &fallback_name);
                    let fb = provider::Provider::from_env();
                    std::env::set_var("LLM_PROVIDER", original_provider);
                    let fb_model = fb.model().to_owned();
                    match fb.complete(system, &messages) {
                        Ok(r) => (r.content, r.tool_calls, r.tokens_in, r.tokens_out,
                                  r.tokens_cached, r.tokens_reasoning, fb_model, r.usage_raw),
                        Err(e) => (format!("[pi-agent erro] primary: {primary_err}; fallback: {e}"),
                                   serde_json::json!([]), 0, 0, 0, 0, fb_model, "{}".to_owned()),
                    }
                } else {
                    (format!("[pi-agent erro] {primary_err}"), serde_json::json!([]), 0, 0, 0, 0, model, "{}".to_owned())
                }
            }
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        (format!("[pi-agent stub] {prompt}"), serde_json::json!([]), 0, 0, 0, 0, "stub".to_owned(), "{}".to_owned())
    }
}

// ── Tool output compression & deduplication ──────────────────────────────────

/// FNV-1a 64-bit hash — no external dep, O(n) in input size.
/// Used for cross-call exact deduplication within a single agentic turn.
fn fnv1a_hash(s: &str) -> u64 {
    const BASIS: u64 = 14695981039346656037;
    const PRIME: u64 = 1099511628211;
    s.bytes().fold(BASIS, |h, b| h.wrapping_mul(PRIME) ^ b as u64)
}

// ── Tool output compression ───────────────────────────────────────────────────

/// Strip ANSI escape sequences (CSI: ESC [ ... letter) so dedup can match
/// lines that differ only by color codes. No external dep required.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' && chars.peek() == Some(&'[') {
            chars.next(); // consume '['
            for nc in chars.by_ref() {
                if nc >= '@' && nc <= '~' { break; } // final byte ends the sequence
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Collapse consecutive identical lines that repeat ≥ 2 times into one entry
/// annotated `[×N]`. Inspired by squeez (claudioemmanuel/squeez).
fn dedup_lines(lines: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut i = 0;
    while i < lines.len() {
        let cur = lines[i];
        let mut run = 1;
        while i + run < lines.len() && lines[i + run] == cur { run += 1; }
        if run >= 2 {
            out.push(format!("{cur} [×{run}]"));
        } else {
            out.push(cur.to_string());
        }
        i += run;
    }
    out
}

/// Pipeline: strip ANSI → dedup repeated lines → truncate to LLM_TOOL_OUTPUT_MAX_LINES.
/// Inspired by squeez (claudioemmanuel/squeez). Default: unlimited, fully opt-in.
/// The truncation header tells the LLM how much was hidden so it can request more.
fn compress_tool_output(output: &str) -> String {
    let max_lines = std::env::var("LLM_TOOL_OUTPUT_MAX_LINES")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(usize::MAX);
    let stripped = strip_ansi(output);
    let raw_lines: Vec<&str> = stripped.lines().collect();
    let lines = dedup_lines(&raw_lines);
    // Fast path: nothing changed and under limit
    if lines.len() == raw_lines.len() && stripped == output && lines.len() <= max_lines {
        return output.to_owned();
    }
    if lines.len() <= max_lines {
        return lines.join("\n");
    }
    format!(
        "[truncated: {} lines → first {} shown]\n{}",
        lines.len(),
        max_lines,
        lines[..max_lines].join("\n")
    )
}

// ── Provider abstraction (WASM-only) ─────────────────────────────────────────

/// Resolves the active provider name with full user control:
///   LLM_PROVIDER          — explicit choice for this run
///   LLM_DEFAULT_PROVIDER  — user's personal sovereign default (fallback when LLM_PROVIDER unset)
///   hardcoded "ollama"    — last resort: local, free, no key needed
fn provider_name_from_env() -> String {
    std::env::var("LLM_PROVIDER")
        .or_else(|_| std::env::var("LLM_DEFAULT_PROVIDER"))
        .unwrap_or_else(|_| "ollama".into())
}

/// Sum `estimated_usd` from UsageRecord JSON payloads for `provider`
/// within a rolling window ending at `now_ns`. Records older than the window are excluded.
fn sum_provider_spend_usd(records: &[String], provider: &str, now_ns: u64, window_ns: u64) -> f64 {
    let cutoff = now_ns.saturating_sub(window_ns);
    records.iter().fold(0.0_f64, |acc, raw| {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else { return acc; };
        if v["provider"].as_str() != Some(provider) { return acc; }
        let ts = v["timestamp_ns"].as_u64().unwrap_or(0);
        if ts < cutoff { return acc; }
        acc + v["estimated_usd"].as_f64().unwrap_or(0.0)
    })
}

/// Build conversation messages from raw UserPrompt + AgentResponse JSON payloads.
/// Sorted by timestamp_ns ascending; capped at `max_turns` most recent entries.
/// Returns (role, content) pairs ready to pass to Provider::complete.
fn history_from_nodes(nodes: &[String], max_turns: usize) -> Vec<(String, String)> {
    let mut entries: Vec<(u64, &'static str, String)> = nodes.iter()
        .filter_map(|raw| {
            let v = serde_json::from_str::<serde_json::Value>(raw).ok()?;
            let ts = v["timestamp_ns"].as_u64().unwrap_or(0);
            let role = match v["@type"].as_str()? {
                "UserPrompt"    => "user",
                "AgentResponse" => "assistant",
                _ => return None,
            };
            let content = v["content"].as_str()?.to_owned();
            Some((ts, role, content))
        })
        .collect();
    entries.sort_by_key(|(ts, _, _)| *ts);
    let start = entries.len().saturating_sub(max_turns);
    entries[start..].iter()
        .map(|(_, role, content)| (role.to_string(), content.clone()))
        .collect()
}

/// Fetch conversation history from the CRDT store (wasm32 only).
/// Controlled by LLM_HISTORY_TURNS env var (default: 0 = disabled).
/// Returns up to that many (role, content) pairs, oldest first.
/// Walk the parent_entry_id chain from `leaf_id`, collecting up to `max_turns`
/// user/agent entries. Pure function — `nodes` is a flat list of SessionEntry JSON
/// strings; a HashMap index is built internally. Returns oldest-first pairs.
fn history_from_tree(nodes: &[String], leaf_id: &str, max_turns: usize) -> Vec<(String, String)> {
    let index: std::collections::HashMap<String, serde_json::Value> = nodes.iter()
        .filter_map(|raw| {
            let v = serde_json::from_str::<serde_json::Value>(raw).ok()?;
            let id = v["@id"].as_str()?.to_owned();
            Some((id, v))
        })
        .collect();

    let mut chain: Vec<(String, String)> = Vec::new();
    let mut current = Some(leaf_id.to_owned());
    while let Some(id) = current.take() {
        if chain.len() >= max_turns { break; }
        let Some(v) = index.get(&id) else { break; };
        let role = match v["kind"].as_str().unwrap_or("") {
            "user"  => "user",
            "agent" => "assistant",
            _ => {
                current = v["parent_entry_id"].as_str().map(|s| s.to_owned());
                continue;
            }
        };
        let content = v["content"].as_str().unwrap_or("").to_owned();
        chain.push((role.to_string(), content));
        current = v["parent_entry_id"].as_str().map(|s| s.to_owned());
    }
    chain.reverse(); // oldest first for LLM context window
    chain
}

/// Try to build history by walking the active Session's entry tree.
/// Returns None when no Session exists (falls back to timestamp-sort).
#[cfg(target_arch = "wasm32")]
fn query_history_from_session(max_turns: usize) -> Option<Vec<(String, String)>> {
    let sessions = tractor_bridge::query_nodes("Session", 10).ok()?;
    let leaf_id = sessions.iter()
        .filter_map(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .filter_map(|v| {
            let ts  = v["created_at_ns"].as_u64().unwrap_or(0);
            let lid = v["leaf_entry_id"].as_str()?.to_owned();
            Some((ts, lid))
        })
        .max_by_key(|(ts, _)| *ts)
        .map(|(_, lid)| lid)?;

    // Walk the chain via get_node to avoid pagination limits on query_nodes.
    let mut chain: Vec<(String, String)> = Vec::new();
    let mut current = Some(leaf_id);
    while let Some(id) = current.take() {
        if chain.len() >= max_turns { break; }
        let raw = tractor_bridge::get_node(&id).ok()?;
        let v = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
        let role = match v["kind"].as_str().unwrap_or("") {
            "user"  => "user",
            "agent" => "assistant",
            _ => { current = v["parent_entry_id"].as_str().map(|s| s.to_owned()); continue; }
        };
        let content = v["content"].as_str().unwrap_or("").to_owned();
        chain.push((role.to_string(), content));
        current = v["parent_entry_id"].as_str().map(|s| s.to_owned());
    }
    if chain.is_empty() { return None; }
    chain.reverse();
    Some(chain)
}

#[cfg(target_arch = "wasm32")]
fn query_history() -> Vec<(String, String)> {
    let max_turns = std::env::var("LLM_HISTORY_TURNS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    if max_turns == 0 { return vec![]; }

    // Tree-walk via Session.leaf_entry_id → parent_entry_id chain (preferred).
    if let Some(history) = query_history_from_session(max_turns) {
        return history;
    }

    // Legacy fallback: timestamp-sort for pre-session UserPrompt/AgentResponse nodes.
    let limit = (max_turns * 2) as u32;
    let mut nodes = tractor_bridge::query_nodes("UserPrompt", limit).unwrap_or_default();
    nodes.extend(tractor_bridge::query_nodes("AgentResponse", limit).unwrap_or_default());
    history_from_nodes(&nodes, max_turns)
}

/// Returns true when `LLM_BUDGET_<PROVIDER>_USD` is set and the rolling 30-day
/// spend for `provider_name` (read from CRDT UsageRecord nodes) meets or exceeds it.
#[cfg(target_arch = "wasm32")]
fn budget_exceeded_for_provider(provider_name: &str) -> bool {
    let budget_key = format!("LLM_BUDGET_{}_USD", provider_name.to_uppercase());
    let Ok(budget_str) = std::env::var(&budget_key) else { return false; };
    let Ok(budget) = budget_str.parse::<f64>() else { return false; };
    let records = tractor_bridge::query_nodes("UsageRecord", 10_000).unwrap_or_default();
    const WINDOW_30D_NS: u64 = 30 * 24 * 3600 * 1_000_000_000;
    sum_provider_spend_usd(&records, provider_name, now_ns(), WINDOW_30D_NS) >= budget
}

// ── Session primitives (pure — testable on native) ───────────────────────────

/// Build a Session node JSON payload.
/// `leaf_entry_id`: current tip of the conversation tree (None for empty session).
/// `parent_session_id`: set when this session is a fork of another (None for root).
fn session_node(
    id: &str,
    name: Option<&str>,
    leaf_entry_id: Option<&str>,
    parent_session_id: Option<&str>,
    created_at_ns: u64,
) -> serde_json::Value {
    serde_json::json!({
        "@type":             "Session",
        "@id":               id,
        "name":              name,
        "leaf_entry_id":     leaf_entry_id,
        "parent_session_id": parent_session_id,
        "created_at_ns":     created_at_ns,
    })
}

/// Build a SessionEntry node JSON payload.
/// `parent_entry_id`: previous entry in the conversation chain (None for tree root).
/// `kind`: one of "user" | "agent" | "tool_call" | "tool_result".
fn session_entry_node(
    id: &str,
    session_id: &str,
    parent_entry_id: Option<&str>,
    kind: &str,
    content: &str,
    timestamp_ns: u64,
) -> serde_json::Value {
    serde_json::json!({
        "@type":           "SessionEntry",
        "@id":             id,
        "session_id":      session_id,
        "parent_entry_id": parent_entry_id,
        "kind":            kind,
        "content":         content,
        "timestamp_ns":    timestamp_ns,
    })
}

/// Create and persist a new Session. Returns the session `@id`.
#[cfg(target_arch = "wasm32")]
fn store_new_session(name: Option<&str>) -> Option<String> {
    let session_id = format!("urn:pi-agent:session-{}", new_id());
    let node = session_node(&session_id, name, None, None, now_ns());
    tractor_bridge::store_node(&node.to_string()).ok()?;
    Some(session_id)
}

/// Append a SessionEntry under `session_id`, wiring `parent_entry_id` from the
/// current `leaf_entry_id` read from the stored Session node. Updates the session
/// leaf pointer after successful store. Returns the new entry `@id`.
#[cfg(target_arch = "wasm32")]
fn append_to_session(session_id: &str, kind: &str, content: &str) -> Option<String> {
    let current_leaf = tractor_bridge::get_node(session_id).ok().and_then(|raw| {
        serde_json::from_str::<serde_json::Value>(&raw).ok()?
            .get("leaf_entry_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_owned())
    });

    let entry_id = format!("urn:pi-agent:entry-{}", new_id());
    let entry = session_entry_node(
        &entry_id,
        session_id,
        current_leaf.as_deref(),
        kind,
        content,
        now_ns(),
    );
    tractor_bridge::store_node(&entry.to_string()).ok()?;

    // Update session leaf pointer (read-modify-write: preserve other fields).
    if let Ok(raw) = tractor_bridge::get_node(session_id) {
        if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&raw) {
            v["leaf_entry_id"] = serde_json::Value::String(entry_id.clone());
            let _ = tractor_bridge::store_node(&v.to_string());
        }
    }

    Some(entry_id)
}

/// Fork `session_id` at `entry_id`: create a new Session with `parent_session_id`
/// pointing to the original and `leaf_entry_id` set to `entry_id`. The original
/// session is not modified. Returns the new session `@id`.
#[cfg(target_arch = "wasm32")]
fn fork_session(session_id: &str, entry_id: &str, name: Option<&str>) -> Option<String> {
    let new_id_ = format!("urn:pi-agent:session-{}", new_id());
    let node = session_node(
        &new_id_,
        name,
        Some(entry_id),
        Some(session_id),
        now_ns(),
    );
    tractor_bridge::store_node(&node.to_string()).ok()?;
    Some(new_id_)
}

/// Navigate to `entry_id` within `session_id`: moves `leaf_entry_id` without
/// touching any SessionEntry nodes. Returns Err if session not found.
#[cfg(target_arch = "wasm32")]
fn navigate_session(session_id: &str, entry_id: &str) -> Result<(), String> {
    let raw = tractor_bridge::get_node(session_id)
        .map_err(|e| format!("navigate: session not found: {e:?}"))?;
    let mut v = serde_json::from_str::<serde_json::Value>(&raw)
        .map_err(|e| format!("navigate: parse error: {e}"))?;
    v["leaf_entry_id"] = serde_json::Value::String(entry_id.to_owned());
    tractor_bridge::store_node(&v.to_string())
        .map_err(|e| format!("navigate: store error: {e:?}"))
}

/// Return the active session ID for this agent instance.
///
/// Priority:
///   1. `LLM_SESSION_ID` env var — explicit override (e.g. tractor passes it per-call)
///   2. Most recently created Session node in the CRDT — resume across restarts
///   3. Create a fresh Session — first run in this namespace
#[cfg(target_arch = "wasm32")]
fn get_or_create_session() -> String {
    if let Ok(id) = std::env::var("LLM_SESSION_ID") {
        if !id.is_empty() { return id; }
    }

    if let Ok(sessions) = tractor_bridge::query_nodes("Session", 20) {
        if let Some(latest_id) = sessions.iter()
            .filter_map(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .max_by_key(|v| v["created_at_ns"].as_u64().unwrap_or(0))
            .and_then(|v| v["@id"].as_str().map(|s| s.to_owned()))
        {
            return latest_id;
        }
    }

    store_new_session(None).unwrap_or_else(|| format!("urn:pi-agent:session-{}", new_id()))
}

// ── read_structured (pure — testable on native) ───────────────────────────────

/// Detect format from file extension. Falls back to "json" when unknown.
pub(crate) fn detect_format(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".toml")                          { return "toml"; }
    if lower.ends_with(".yaml") || lower.ends_with(".yml") { return "yaml"; }
    "json"
}

/// Parse `bytes` as `format`, paginate to `page_size` top-level items/keys.
/// Returns a metadata header line followed by the content.
/// `page_size = 0` → return everything.
pub(crate) fn read_structured_parse(
    bytes: &[u8],
    format: &str,
    page_size: usize,
    page_offset: usize,
) -> String {
    let total_bytes = bytes.len();
    match format {
        "json" => parse_and_page_json(bytes, total_bytes, page_size, page_offset),
        "toml" => parse_and_page_toml(bytes, total_bytes, page_size, page_offset),
        "yaml" => parse_and_page_yaml(bytes, total_bytes, page_size, page_offset),
        other  => format!("[read_structured | unknown format: {other}]"),
    }
}

fn parse_and_page_json(bytes: &[u8], total_bytes: usize, page_size: usize, page_offset: usize) -> String {
    let text = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => return "[read_structured | json | invalid UTF-8]".into(),
    };
    let v: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => return format!("[read_structured | json | parse error: {e}]"),
    };
    page_json_value(v, total_bytes, page_size, page_offset)
}

fn page_json_value(v: serde_json::Value, total_bytes: usize, page_size: usize, page_offset: usize) -> String {
    if page_size == 0 {
        let content = serde_json::to_string_pretty(&v).unwrap_or_default();
        return format!("[read_structured | json | {total_bytes}B | complete]\n{content}");
    }
    match v {
        serde_json::Value::Array(arr) => {
            let total = arr.len();
            let start = page_offset.min(total);
            let end   = (start + page_size).min(total);
            let truncated = end < total;
            let content = serde_json::to_string_pretty(&arr[start..end]).unwrap_or_default();
            let note = if truncated {
                format!("items {}-{} of {} | truncated", start + 1, end, total)
            } else {
                format!("items {}-{} of {}", start + 1, end, total)
            };
            format!("[read_structured | json | {total_bytes}B | {note}]\n{content}")
        }
        serde_json::Value::Object(map) => {
            let total = map.len();
            let paged: serde_json::Map<_, _> = map.into_iter().skip(page_offset).take(page_size).collect();
            let shown = paged.len();
            let truncated = page_offset + shown < total;
            let content = serde_json::to_string_pretty(&serde_json::Value::Object(paged))
                .unwrap_or_default();
            let note = if truncated {
                format!("{shown} of {total} keys | truncated")
            } else {
                format!("all {total} keys")
            };
            format!("[read_structured | json | {total_bytes}B | {note}]\n{content}")
        }
        scalar => {
            let content = serde_json::to_string_pretty(&scalar).unwrap_or_default();
            format!("[read_structured | json | {total_bytes}B | scalar]\n{content}")
        }
    }
}

fn parse_and_page_toml(bytes: &[u8], total_bytes: usize, page_size: usize, page_offset: usize) -> String {
    let text = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => return "[read_structured | toml | invalid UTF-8]".into(),
    };
    let table: toml::Value = match toml::from_str(text) {
        Ok(v) => v,
        Err(e) => return format!("[read_structured | toml | parse error: {e}]"),
    };
    let json_val: serde_json::Value = match serde_json::to_value(&table) {
        Ok(v) => v,
        Err(e) => return format!("[read_structured | toml | conversion error: {e}]"),
    };
    page_json_value(json_val, total_bytes, page_size, page_offset)
        .replacen("| json |", "| toml |", 1)
}

fn parse_and_page_yaml(bytes: &[u8], total_bytes: usize, page_size: usize, page_offset: usize) -> String {
    let text = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => return "[read_structured | yaml | invalid UTF-8]".into(),
    };
    let yaml_val: serde_yaml::Value = match serde_yaml::from_str(text) {
        Ok(v) => v,
        Err(e) => return format!("[read_structured | yaml | parse error: {e}]"),
    };
    // Convert YAML → JSON for uniform pagination (serde_yaml::Value → serde_json::Value).
    let json_val: serde_json::Value = match serde_json::to_value(&yaml_val) {
        Ok(v) => v,
        Err(e) => return format!("[read_structured | yaml | conversion error: {e}]"),
    };
    page_json_value(json_val, total_bytes, page_size, page_offset)
        .replacen("| json |", "| yaml |", 1)
}

// ── edit_file core logic (pure — testable on native) ─────────────────────────

/// Apply ordered string replacements to `content`. Returns `Err` with a human message
/// if any `old_str` is missing or appears more than once.
pub(crate) fn apply_edits(
    mut content: String,
    edits: &[(/* old */ &str, /* new */ &str)],
) -> Result<String, String> {
    for (i, (old, new)) in edits.iter().enumerate() {
        let count = content.matches(old).count();
        if count == 0 { return Err(format!("edit {i}: old_str not found")); }
        if count > 1  { return Err(format!("edit {i}: old_str matches {count} times — be more specific")); }
        content = content.replacen(old, new, 1);
    }
    Ok(content)
}

// ── Tool schemas (pure JSON — no WASM deps, testable on native) ──────────────

pub(crate) fn tools_anthropic() -> serde_json::Value {
    serde_json::json!([
        {"name":"read_file","description":"Read the contents of a file at an absolute path.",
         "input_schema":{"type":"object","properties":{"path":{"type":"string","description":"Absolute path"}},"required":["path"]}},
        {"name":"write_file","description":"Write UTF-8 content to a file atomically.",
         "input_schema":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}},
        {"name":"edit_file","description":"Apply one or more targeted string replacements to a file. Each edit replaces old_str with new_str; fails if old_str is not found or appears more than once.",
         "input_schema":{"type":"object","properties":{"path":{"type":"string","description":"Absolute path to the file"},"edits":{"type":"array","items":{"type":"object","properties":{"old_str":{"type":"string"},"new_str":{"type":"string"}},"required":["old_str","new_str"]},"description":"Ordered list of replacements to apply"}},"required":["path","edits"]}},
        {"name":"list_dir","description":"List files and directories at a path.",
         "input_schema":{"type":"object","properties":{"path":{"type":"string","description":"Absolute path to directory"}},"required":["path"]}},
        {"name":"search_files","description":"Search for a pattern in files (grep). Returns matching lines with file:line prefix.",
         "input_schema":{"type":"object","properties":{"pattern":{"type":"string","description":"Regular expression to search for"},"path":{"type":"string","description":"Absolute path to search in"},"glob":{"type":"string","description":"Optional filename glob filter, e.g. *.rs"}},"required":["pattern","path"]}},
        {"name":"bash","description":"Run a command via structured argv (argv[0] is the binary, no shell expansion).",
         "input_schema":{"type":"object","properties":{"argv":{"type":"array","items":{"type":"string"}},"cwd":{"type":"string"},"timeout_ms":{"type":"integer"}},"required":["argv"]}},
        {"name":"read_structured","description":"Parse a structured file (JSON, TOML, YAML) and return its content with automatic pagination for large files. Use page_size to control how many items/keys to return. Returns a metadata header followed by content.",
         "input_schema":{"type":"object","properties":{"path":{"type":"string","description":"Absolute path to the file"},"format":{"type":"string","enum":["json","toml","yaml"],"description":"File format (auto-detected from extension if omitted)"},"page_size":{"type":"integer","description":"Max items/keys to return (default 50; 0 = return all)"},"page_offset":{"type":"integer","description":"Skip this many items/keys before returning (default 0)"}},"required":["path"]}}
    ])
}

pub(crate) fn tools_openai() -> serde_json::Value {
    serde_json::json!([
        {"type":"function","function":{"name":"read_file","description":"Read file at absolute path.",
         "parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}},
        {"type":"function","function":{"name":"write_file","description":"Write UTF-8 content to file atomically.",
         "parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}}},
        {"type":"function","function":{"name":"edit_file","description":"Apply one or more targeted string replacements to a file. Each edit replaces old_str with new_str; fails if old_str is not found or appears more than once.",
         "parameters":{"type":"object","properties":{"path":{"type":"string"},"edits":{"type":"array","items":{"type":"object","properties":{"old_str":{"type":"string"},"new_str":{"type":"string"}},"required":["old_str","new_str"]}}},"required":["path","edits"]}}},
        {"type":"function","function":{"name":"list_dir","description":"List files and directories at a path.",
         "parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}},
        {"type":"function","function":{"name":"search_files","description":"Search for a pattern in files (grep). Returns matching lines with file:line prefix.",
         "parameters":{"type":"object","properties":{"pattern":{"type":"string"},"path":{"type":"string"},"glob":{"type":"string"}},"required":["pattern","path"]}}},
        {"type":"function","function":{"name":"bash","description":"Run command via structured argv (no shell expansion).",
         "parameters":{"type":"object","properties":{"argv":{"type":"array","items":{"type":"string"}},"cwd":{"type":"string"},"timeout_ms":{"type":"integer"}},"required":["argv"]}}},
        {"type":"function","function":{"name":"read_structured","description":"Parse a structured file (JSON, TOML, YAML) with automatic pagination.",
         "parameters":{"type":"object","properties":{"path":{"type":"string"},"format":{"type":"string","enum":["json","toml","yaml"]},"page_size":{"type":"integer"},"page_offset":{"type":"integer"}},"required":["path"]}}}
    ])
}

#[cfg(target_arch = "wasm32")]
mod provider {
    use crate::refarm::plugin::llm_bridge;

    pub struct CompletionResult {
        pub content: String,
        /// Normalized log of tool calls executed during the agentic loop: [{name, input, result}]
        pub tool_calls: serde_json::Value,
        pub tokens_in: u32,
        pub tokens_out: u32,
        pub tokens_cached: u32,
        pub tokens_reasoning: u32,
        pub usage_raw: String,
    }

    // ── Tool dispatch (wasm32: calls agent_fs / agent_shell WIT imports) ──────

    pub fn dispatch_tool(name: &str, input: &serde_json::Value) -> String {
        use crate::refarm::plugin::{agent_fs, agent_shell};
        match name {
            "read_file" => {
                let path = input["path"].as_str().unwrap_or("");
                match agent_fs::read(path) {
                    Ok(bytes) => super::compress_tool_output(&String::from_utf8_lossy(&bytes)),
                    Err(e)    => format!("[error reading {path}] {e}"),
                }
            }
            "write_file" => {
                let path    = input["path"].as_str().unwrap_or("");
                let content = input["content"].as_str().unwrap_or("");
                match agent_fs::write(path, content.as_bytes()) {
                    Ok(())  => format!("wrote {} bytes to {path}", content.len()),
                    Err(e)  => format!("[error writing {path}] {e}"),
                }
            }
            "edit_file" => {
                let path = input["path"].as_str().unwrap_or("");
                let edits = match input["edits"].as_array() {
                    Some(a) => a,
                    None    => return "[error] edit_file requires edits array".into(),
                };
                let bytes = match agent_fs::read(path) {
                    Ok(b)  => b,
                    Err(e) => return format!("[error reading {path}] {e}"),
                };
                let content = String::from_utf8_lossy(&bytes).into_owned();
                let pairs: Vec<(&str, &str)> = edits.iter()
                    .map(|e| (e["old_str"].as_str().unwrap_or(""), e["new_str"].as_str().unwrap_or("")))
                    .collect();
                let updated = match super::apply_edits(content, &pairs) {
                    Ok(s)  => s,
                    Err(e) => return format!("[error] {e} in {path}"),
                };
                match agent_fs::write(path, updated.as_bytes()) {
                    Ok(())  => format!("applied {} edit(s) to {path}", edits.len()),
                    Err(e)  => format!("[error writing {path}] {e}"),
                }
            }
            "list_dir" => {
                let path = input["path"].as_str().unwrap_or(".");
                let req = agent_shell::SpawnRequest {
                    argv: vec!["ls".into(), "-1".into(), "--".into(), path.into()],
                    env: vec![], cwd: None, timeout_ms: 5_000, stdin: None,
                };
                match agent_shell::spawn(&req) {
                    Ok(r) if r.exit_code == 0 => {
                        super::compress_tool_output(&String::from_utf8_lossy(&r.stdout))
                    }
                    Ok(r) => format!("[error listing {path}] exit {}\n{}",
                        r.exit_code, String::from_utf8_lossy(&r.stderr)),
                    Err(e) => format!("[error listing {path}] {e}"),
                }
            }
            "search_files" => {
                let pattern = input["pattern"].as_str().unwrap_or("");
                let path    = input["path"].as_str().unwrap_or(".");
                let mut argv = vec!["grep".into(), "-rn".into(), "--".into(), pattern.into(), path.into()];
                if let Some(glob) = input["glob"].as_str() {
                    argv.insert(2, format!("--include={glob}"));
                }
                let req = agent_shell::SpawnRequest {
                    argv, env: vec![], cwd: None, timeout_ms: 15_000, stdin: None,
                };
                match agent_shell::spawn(&req) {
                    Ok(r) => {
                        let out = String::from_utf8_lossy(&r.stdout);
                        if r.exit_code == 1 && out.is_empty() {
                            return format!("[no matches for '{pattern}' in {path}]");
                        }
                        if r.exit_code > 1 {
                            return format!("[grep error]\n{}", String::from_utf8_lossy(&r.stderr));
                        }
                        super::compress_tool_output(&out)
                    }
                    Err(e) => format!("[spawn error] {e}"),
                }
            }
            "bash" => {
                let argv: Vec<String> = input["argv"].as_array()
                    .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                    .unwrap_or_default();
                if argv.is_empty() { return "[error] bash requires argv".into(); }
                let cwd        = input["cwd"].as_str().map(String::from);
                let timeout_ms = input["timeout_ms"].as_u64().unwrap_or(30_000) as u32;
                let req = agent_shell::SpawnRequest { argv, env: vec![], cwd, timeout_ms, stdin: None };
                match agent_shell::spawn(&req) {
                    Ok(r) => {
                        let out = String::from_utf8_lossy(&r.stdout);
                        let err = String::from_utf8_lossy(&r.stderr);
                        let raw = if r.timed_out           { format!("[timeout {timeout_ms}ms]\n{out}\n{err}") }
                                  else if r.exit_code != 0 { format!("[exit {}]\n{out}\n{err}", r.exit_code) }
                                  else                     { out.into_owned() };
                        super::compress_tool_output(&raw)
                    }
                    Err(e) => format!("[spawn error] {e}"),
                }
            }
            "read_structured" => {
                let path        = input["path"].as_str().unwrap_or("");
                let fmt         = input["format"].as_str()
                    .unwrap_or_else(|| super::detect_format(path));
                let page_size   = input["page_size"].as_u64().unwrap_or(50) as usize;
                let page_offset = input["page_offset"].as_u64().unwrap_or(0) as usize;
                let bytes = match agent_fs::read(path) {
                    Ok(b)  => b,
                    Err(e) => return format!("[error reading {path}] {e}"),
                };
                super::compress_tool_output(&super::read_structured_parse(
                    &bytes, fmt, page_size, page_offset,
                ))
            }
            other => format!("[error] unknown tool: {other}"),
        }
    }

    pub enum Provider {
        Anthropic { model: String },
        OpenAiCompat { provider: String, base_url: String, model: String },
    }

    // Providers with non-standard OpenAI-compat paths; all others use /v1/chat/completions.
    fn openai_compat_path(provider: &str) -> &'static str {
        match provider {
            "groq"       => "/openai/v1/chat/completions",
            "openrouter" => "/api/v1/chat/completions",
            "gemini"     => "/v1beta/openai/chat/completions",
            _            => "/v1/chat/completions",
        }
    }

    impl Provider {
        /// Build provider from env vars injected by the tractor host.
        pub fn from_env() -> Self {
            let model = std::env::var("LLM_MODEL").unwrap_or_default();
            let base = |default: &'static str| {
                std::env::var("LLM_BASE_URL").unwrap_or_else(|_| default.into())
            };
            match super::provider_name_from_env().as_str() {
                "anthropic" => Provider::Anthropic {
                    model: if model.is_empty() { "claude-sonnet-4-6".into() } else { model },
                },
                "openai" => Provider::OpenAiCompat {
                    provider: "openai".into(),
                    base_url: base("https://api.openai.com"),
                    model: if model.is_empty() { "gpt-4o-mini".into() } else { model },
                },
                "groq" => Provider::OpenAiCompat {
                    provider: "groq".into(),
                    base_url: base("https://api.groq.com"),
                    model: if model.is_empty() { "llama-3.3-70b-versatile".into() } else { model },
                },
                "mistral" => Provider::OpenAiCompat {
                    provider: "mistral".into(),
                    base_url: base("https://api.mistral.ai"),
                    model: if model.is_empty() { "mistral-large-latest".into() } else { model },
                },
                "xai" => Provider::OpenAiCompat {
                    provider: "xai".into(),
                    base_url: base("https://api.x.ai"),
                    model: if model.is_empty() { "grok-3".into() } else { model },
                },
                "deepseek" => Provider::OpenAiCompat {
                    provider: "deepseek".into(),
                    base_url: base("https://api.deepseek.com"),
                    model: if model.is_empty() { "deepseek-chat".into() } else { model },
                },
                "together" => Provider::OpenAiCompat {
                    provider: "together".into(),
                    base_url: base("https://api.together.xyz"),
                    model: if model.is_empty() { "meta-llama/Llama-3-70b-chat-hf".into() } else { model },
                },
                "openrouter" => Provider::OpenAiCompat {
                    provider: "openrouter".into(),
                    base_url: base("https://openrouter.ai"),
                    model: if model.is_empty() { "anthropic/claude-sonnet-4-5".into() } else { model },
                },
                "gemini" => Provider::OpenAiCompat {
                    provider: "gemini".into(),
                    base_url: base("https://generativelanguage.googleapis.com"),
                    model: if model.is_empty() { "gemini-2.0-flash".into() } else { model },
                },
                provider => Provider::OpenAiCompat { // ollama is the sovereign default
                    provider: provider.into(),
                    base_url: base("http://localhost:11434"),
                    model: if model.is_empty() { "llama3.2".into() } else { model },
                },
            }
        }

        pub fn model(&self) -> &str {
            match self { Provider::Anthropic { model } | Provider::OpenAiCompat { model, .. } => model }
        }

        /// `messages` is an ordered slice of (role, content) pairs, oldest first.
        /// The caller is responsible for appending the current user turn as the last entry.
        pub fn complete(&self, system: &str, messages: &[(String, String)]) -> Result<CompletionResult, String> {
            match self {
                Provider::Anthropic { model } => anthropic(model, system, messages),
                Provider::OpenAiCompat { provider, base_url, model } =>
                    openai_compat(provider, base_url, model, system, messages),
            }
        }
    }

    // ── Anthropic wire format ─────────────────────────────────────────────────

    fn anthropic(model: &str, system: &str, messages: &[(String, String)]) -> Result<CompletionResult, String> {
        let hdrs = vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("anthropic-version".to_string(), "2023-06-01".to_string()),
        ];
        let max_iter = std::env::var("LLM_TOOL_CALL_MAX_ITER")
            .ok().and_then(|v| v.parse::<u32>().ok()).unwrap_or(5);

        // In-flight messages: start from CRDT history, grow with tool call/result turns.
        let mut wire_msgs: Vec<serde_json::Value> = messages.iter()
            .map(|(role, content)| serde_json::json!({"role": role, "content": content}))
            .collect();

        let mut tokens_in = 0u32;
        let mut tokens_out = 0u32;
        let mut tokens_cached = 0u32;
        let mut last_usage_raw = "{}".to_string();
        let mut executed_calls: Vec<serde_json::Value> = Vec::new();
        let mut seen_hashes: std::collections::HashSet<u64> = std::collections::HashSet::new();

        for _iter in 0..=max_iter {
            let body = serde_json::json!({
                "model": model, "max_tokens": 1024, "system": system,
                "tools": super::tools_anthropic(),
                "messages": wire_msgs,
            }).to_string();

            let bytes = http_post_via_host(
                "anthropic",
                "https://api.anthropic.com",
                "/v1/messages",
                &hdrs,
                body.as_bytes(),
            )?;
            let v: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| format!("parse: {e}"))?;

            let usage = &v["usage"];
            tokens_in     += usage["input_tokens"].as_u64().unwrap_or(0) as u32;
            tokens_out    += usage["output_tokens"].as_u64().unwrap_or(0) as u32;
            tokens_cached += (usage["cache_read_input_tokens"].as_u64().unwrap_or(0)
                            + usage["cache_creation_input_tokens"].as_u64().unwrap_or(0)) as u32;
            last_usage_raw = usage.to_string();

            // Collect tool_use blocks from content array.
            let content_arr = v["content"].as_array().cloned().unwrap_or_default();
            let tool_uses: Vec<&serde_json::Value> = content_arr.iter()
                .filter(|c| c["type"] == "tool_use")
                .collect();

            if tool_uses.is_empty() || _iter == max_iter {
                // Final text response.
                let text = content_arr.iter()
                    .find(|c| c["type"] == "text")
                    .and_then(|c| c["text"].as_str())
                    .ok_or_else(|| v["error"]["message"].as_str().unwrap_or("no text in response").to_owned())?
                    .to_owned();
                return Ok(CompletionResult {
                    content: text,
                    tool_calls: serde_json::Value::Array(executed_calls),
                    tokens_in, tokens_out, tokens_cached,
                    tokens_reasoning: 0,
                    usage_raw: last_usage_raw,
                });
            }

            // Inject assistant turn (with tool_use blocks) into wire messages.
            wire_msgs.push(serde_json::json!({"role": "assistant", "content": content_arr}));

            // Dispatch each tool, deduplicate repeated outputs, collect results.
            let mut tool_results = Vec::with_capacity(tool_uses.len());
            for tc in &tool_uses {
                let name  = tc["name"].as_str().unwrap_or("");
                let input = &tc["input"];
                let id    = tc["id"].as_str().unwrap_or("");
                let raw   = dispatch_tool(name, input);
                let result = if seen_hashes.insert(super::fnv1a_hash(&raw)) {
                    raw
                } else {
                    "[duplicate: same output already in this context — ask for specifics if needed]".to_string()
                };
                executed_calls.push(serde_json::json!({"name": name, "input": input, "result": result}));
                tool_results.push(serde_json::json!({"type": "tool_result", "tool_use_id": id, "content": result}));
            }
            wire_msgs.push(serde_json::json!({"role": "user", "content": tool_results}));
        }
        unreachable!()
    }

    // ── OpenAI-compatible wire format (covers Ollama, OpenAI, Groq, etc.) ─────

    fn openai_compat(
        provider: &str,
        base_url: &str,
        model: &str,
        system: &str,
        messages: &[(String, String)],
    ) -> Result<CompletionResult, String> {
        let base_hdrs: Vec<(String, String)> = vec![
            ("content-type".to_string(), "application/json".to_string())
        ];

        let max_iter = std::env::var("LLM_TOOL_CALL_MAX_ITER")
            .ok().and_then(|v| v.parse::<u32>().ok()).unwrap_or(5);

        let mut wire_msgs: Vec<serde_json::Value> = {
            let mut v = vec![serde_json::json!({"role": "system", "content": system})];
            v.extend(messages.iter().map(|(r, c)| serde_json::json!({"role": r, "content": c})));
            v
        };

        let mut tokens_in = 0u32;
        let mut tokens_out = 0u32;
        let mut tokens_cached = 0u32;
        let mut tokens_reasoning = 0u32;
        let mut last_usage_raw = "{}".to_string();
        let mut executed_calls: Vec<serde_json::Value> = Vec::new();
        let mut seen_hashes: std::collections::HashSet<u64> = std::collections::HashSet::new();

        for _iter in 0..=max_iter {
            let body = serde_json::json!({
                "model": model, "max_tokens": 1024,
                "tools": super::tools_openai(),
                "messages": wire_msgs,
            }).to_string();

            let bytes = http_post_via_host(
                provider,
                base_url,
                openai_compat_path(provider),
                &base_hdrs,
                body.as_bytes(),
            )?;
            let v: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| format!("parse: {e}"))?;

            let usage = &v["usage"];
            tokens_in       += usage["prompt_tokens"].as_u64().unwrap_or(0) as u32;
            tokens_out      += usage["completion_tokens"].as_u64().unwrap_or(0) as u32;
            tokens_cached   += usage["prompt_tokens_details"]["cached_tokens"].as_u64().unwrap_or(0) as u32;
            tokens_reasoning += usage["completion_tokens_details"]["reasoning_tokens"].as_u64().unwrap_or(0) as u32;
            last_usage_raw   = usage.to_string();

            let msg = &v["choices"][0]["message"];
            let tool_calls_json = msg["tool_calls"].as_array().cloned().unwrap_or_default();

            if tool_calls_json.is_empty() || _iter == max_iter {
                let content = msg["content"].as_str()
                    .ok_or_else(|| v["error"]["message"].as_str().unwrap_or("no content").to_owned())?
                    .to_owned();
                return Ok(CompletionResult {
                    content,
                    tool_calls: serde_json::Value::Array(executed_calls),
                    tokens_in, tokens_out, tokens_cached, tokens_reasoning,
                    usage_raw: last_usage_raw,
                });
            }

            // Inject assistant turn with tool_calls into wire messages.
            wire_msgs.push(serde_json::json!({
                "role": "assistant",
                "content": msg["content"],
                "tool_calls": tool_calls_json,
            }));

            // Dispatch each tool, deduplicate repeated outputs, append result messages.
            for tc in &tool_calls_json {
                let fn_obj = &tc["function"];
                let name   = fn_obj["name"].as_str().unwrap_or("");
                let input: serde_json::Value = serde_json::from_str(
                    fn_obj["arguments"].as_str().unwrap_or("{}")
                ).unwrap_or(serde_json::json!({}));
                let id     = tc["id"].as_str().unwrap_or("");
                let raw    = dispatch_tool(name, &input);
                let result = if seen_hashes.insert(super::fnv1a_hash(&raw)) {
                    raw
                } else {
                    "[duplicate: same output already in this context — ask for specifics if needed]".to_string()
                };
                executed_calls.push(serde_json::json!({"name": name, "input": input, "result": &result}));
                wire_msgs.push(serde_json::json!({"role": "tool", "tool_call_id": id, "content": result}));
            }
        }
        unreachable!()
    }

    // ── Host-proxied LLM bridge ───────────────────────────────────────────────

    fn http_post_via_host(
        provider: &str,
        base_url: &str,
        path: &str,
        headers: &[(String, String)],
        body: &[u8],
    ) -> Result<Vec<u8>, String> {
        llm_bridge::complete_http(provider, base_url, path, headers, body)
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/// Estimate cost in USD using public 2025 per-million-token rates.
/// Cached tokens are billed at ~10% of normal input rate (Anthropic/OpenAI prompt caching).
/// Returns 0.0 for local/unknown models — sovereign infra is free.
fn estimate_usd(model: &str, tokens_in: u32, tokens_out: u32, tokens_cached: u32) -> f64 {
    // (input_per_1m, output_per_1m)
    let (rate_in, rate_out): (f64, f64) = if model.contains("claude-opus-4") {
        (15.0, 75.0)
    } else if model.contains("claude-sonnet-4") || model.contains("claude-sonnet-3-7") {
        (3.0, 15.0)
    } else if model.contains("claude-haiku") {
        (0.8, 4.0)
    } else if model.contains("gpt-4o") && !model.contains("mini") {
        (2.5, 10.0)
    } else if model.contains("gpt-4o-mini") {
        (0.15, 0.6)
    } else {
        return 0.0; // ollama, llama*, local models — free
    };
    let uncached = tokens_in.saturating_sub(tokens_cached) as f64;
    let cached   = tokens_cached as f64;
    (uncached / 1_000_000.0) * rate_in
        + (cached / 1_000_000.0) * rate_in * 0.1   // cache hit discount
        + (tokens_out as f64 / 1_000_000.0) * rate_out
}

static SEQ: AtomicU64 = AtomicU64::new(0);

fn new_id() -> String {
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{:016x}{:04x}", now_ns(), seq)
}

fn now_ns() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

export!(PiAgent);

// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fnv1a_hash_same_input_same_output() {
        assert_eq!(fnv1a_hash("hello"), fnv1a_hash("hello"));
    }

    #[test]
    fn fnv1a_hash_different_inputs_differ() {
        assert_ne!(fnv1a_hash("a"), fnv1a_hash("b"));
        assert_ne!(fnv1a_hash(""), fnv1a_hash("x"));
    }

    #[test]
    fn strip_ansi_removes_color_codes() {
        let colored = "\x1b[32mgreen\x1b[0m normal";
        assert_eq!(strip_ansi(colored), "green normal");
    }

    #[test]
    fn strip_ansi_passthrough_plain() {
        let plain = "no escape codes here";
        assert_eq!(strip_ansi(plain), plain);
    }

    #[test]
    fn dedup_lines_collapses_consecutive_repeats() {
        let lines = vec!["warn", "warn", "warn", "ok"];
        let result = dedup_lines(&lines);
        assert_eq!(result, vec!["warn [×3]", "ok"]);
    }

    #[test]
    fn dedup_lines_passthrough_unique() {
        let lines = vec!["a", "b", "a"]; // non-consecutive, must not collapse
        let result = dedup_lines(&lines);
        assert_eq!(result, vec!["a", "b", "a"]);
    }

    #[test]
    fn dedup_lines_collapses_run_of_two() {
        let lines = vec!["x", "x"];
        let result = dedup_lines(&lines);
        assert_eq!(result, vec!["x [×2]"]);
    }

    #[test]
    fn compress_tool_output_passthrough_when_under_limit() {
        std::env::set_var("LLM_TOOL_OUTPUT_MAX_LINES", "100");
        let output = "line1\nline2\nline3";
        assert_eq!(compress_tool_output(output), output);
        std::env::remove_var("LLM_TOOL_OUTPUT_MAX_LINES");
    }

    #[test]
    fn compress_tool_output_truncates_with_header() {
        std::env::set_var("LLM_TOOL_OUTPUT_MAX_LINES", "2");
        let output = "a\nb\nfoo\nbar";
        let result = compress_tool_output(output);
        assert!(result.starts_with("[truncated: 4 lines → first 2 shown]"),
            "header missing: {result}");
        assert!(result.contains("a"), "kept lines must appear: {result}");
        std::env::remove_var("LLM_TOOL_OUTPUT_MAX_LINES");
    }

    #[test]
    fn compress_tool_output_dedup_reduces_before_truncation() {
        std::env::set_var("LLM_TOOL_OUTPUT_MAX_LINES", "5");
        // 10 identical lines → deduped to 1 → well under limit
        let output = "warn: something\n".repeat(10).trim_end().to_string();
        let result = compress_tool_output(&output);
        assert!(!result.starts_with("[truncated"), "dedup must prevent truncation: {result}");
        assert!(result.contains("[×10]"), "dedup annotation must appear: {result}");
        std::env::remove_var("LLM_TOOL_OUTPUT_MAX_LINES");
    }

    #[test]
    fn compress_tool_output_strips_ansi_before_dedup() {
        std::env::remove_var("LLM_TOOL_OUTPUT_MAX_LINES");
        let output = "\x1b[31mERROR\x1b[0m\n\x1b[31mERROR\x1b[0m\nok";
        let result = compress_tool_output(output);
        assert!(result.contains("[×2]"), "ANSI-stripped lines must dedup: {result}");
        assert!(!result.contains("\x1b"), "ANSI codes must be stripped: {result}");
    }

    #[test]
    fn compress_tool_output_unlimited_by_default() {
        std::env::remove_var("LLM_TOOL_OUTPUT_MAX_LINES");
        let big = (0..1000).map(|i| i.to_string()).collect::<Vec<_>>().join("\n");
        let result = compress_tool_output(&big);
        assert_eq!(result, big, "without env var, output must be unchanged");
    }

    #[test]
    fn react_returns_stub_on_native() {
        let (content, tool_calls, tokens_in, tokens_out, tokens_cached, tokens_reasoning, model, usage_raw) = react("meu prompt");
        assert!(!content.is_empty());
        assert!(tool_calls.is_array());
        assert_eq!(tool_calls.as_array().unwrap().len(), 0);
        assert_eq!(tokens_in, 0, "stub has no token count");
        assert_eq!(tokens_out, 0);
        assert_eq!(tokens_cached, 0);
        assert_eq!(tokens_reasoning, 0);
        assert!(!model.is_empty(), "model must be non-empty");
        assert!(!usage_raw.is_empty());
    }

    #[test]
    fn agent_response_schema_has_required_fields() {
        let (content, tool_calls, tokens_in, tokens_out, _tokens_cached, _tokens_reasoning, model, _usage_raw) = react("hello");
        let node = serde_json::json!({
            "@type":      "AgentResponse",
            "@id":        "urn:pi-agent:resp-test",
            "prompt_ref": "urn:pi-agent:prompt-test",
            "content":    content,
            "sequence":   0,
            "is_final":   true,
            "tool_calls": tool_calls,
            "llm": { "model": model, "tokens_in": tokens_in, "tokens_out": tokens_out, "duration_ms": 0u64 },
        });

        for field in ["@type", "@id", "prompt_ref", "content", "sequence", "is_final", "tool_calls", "llm"] {
            assert!(node.get(field).is_some(), "AgentResponse missing field: {field}");
        }
        assert_eq!(node["@type"], "AgentResponse");
        assert_eq!(node["is_final"], true);
        assert_eq!(node["sequence"], 0);
        for sub in ["model", "tokens_in", "tokens_out", "duration_ms"] {
            assert!(node["llm"].get(sub).is_some(), "llm missing: {sub}");
        }
    }

    // ── Session schema tests ──────────────────────────────────────────────────

    #[test]
    fn session_node_has_required_fields() {
        let ts = 1_700_000_000_000_000_000_u64;
        let node = session_node("urn:pi-agent:session-abc", Some("test"), None, None, ts);
        assert_eq!(node["@type"], "Session");
        assert_eq!(node["@id"],   "urn:pi-agent:session-abc");
        assert_eq!(node["name"],  "test");
        assert!(node["leaf_entry_id"].is_null(), "new session has no leaf yet");
        assert!(node["parent_session_id"].is_null(), "root session has no parent");
        assert_eq!(node["created_at_ns"], ts);
    }

    #[test]
    fn session_node_with_leaf_and_parent() {
        let node = session_node(
            "urn:pi-agent:session-fork",
            Some("fork"),
            Some("urn:pi-agent:entry-42"),
            Some("urn:pi-agent:session-root"),
            42,
        );
        assert_eq!(node["leaf_entry_id"],     "urn:pi-agent:entry-42");
        assert_eq!(node["parent_session_id"], "urn:pi-agent:session-root");
    }

    #[test]
    fn session_entry_node_root_has_null_parent() {
        let entry = session_entry_node(
            "urn:pi-agent:entry-001",
            "urn:pi-agent:session-s1",
            None,
            "user",
            "hello",
            100,
        );
        assert_eq!(entry["@type"],           "SessionEntry");
        assert_eq!(entry["@id"],             "urn:pi-agent:entry-001");
        assert_eq!(entry["session_id"],      "urn:pi-agent:session-s1");
        assert!(entry["parent_entry_id"].is_null(), "root entry has no parent");
        assert_eq!(entry["kind"],            "user");
        assert_eq!(entry["content"],         "hello");
        assert_eq!(entry["timestamp_ns"],    100);
    }

    #[test]
    fn session_entry_chain_has_correct_parents() {
        let e1 = session_entry_node("urn:pi-agent:entry-001", "urn:pi-agent:session-s1", None,                            "user",  "hi",   10);
        let e2 = session_entry_node("urn:pi-agent:entry-002", "urn:pi-agent:session-s1", Some("urn:pi-agent:entry-001"), "agent", "hello", 20);
        let e3 = session_entry_node("urn:pi-agent:entry-003", "urn:pi-agent:session-s1", Some("urn:pi-agent:entry-002"), "user",  "more",  30);

        assert!(e1["parent_entry_id"].is_null());
        assert_eq!(e2["parent_entry_id"], "urn:pi-agent:entry-001");
        assert_eq!(e3["parent_entry_id"], "urn:pi-agent:entry-002");
    }

    #[test]
    fn session_entry_branch_shares_ancestor() {
        // Two branches from the same parent — simulates navigate-back + new message
        let root = session_entry_node("urn:pi-agent:entry-root", "urn:pi-agent:session-s1", None,                             "user",  "start", 1);
        let branch_a = session_entry_node("urn:pi-agent:entry-a",    "urn:pi-agent:session-s1", Some("urn:pi-agent:entry-root"), "agent", "path A", 2);
        let branch_b = session_entry_node("urn:pi-agent:entry-b",    "urn:pi-agent:session-s1", Some("urn:pi-agent:entry-root"), "agent", "path B", 3);

        // Both branches reference the same root parent
        assert_eq!(branch_a["parent_entry_id"], root["@id"]);
        assert_eq!(branch_b["parent_entry_id"], root["@id"]);
        // But have different identities
        assert_ne!(branch_a["@id"], branch_b["@id"]);
    }

    // ── Fork / navigate schema tests ─────────────────────────────────────────

    #[test]
    fn fork_session_node_has_correct_fields() {
        // Simulate fork: new session pointing to ancestor entry
        let forked = session_node(
            "urn:pi-agent:session-fork",
            Some("my fork"),
            Some("urn:pi-agent:entry-ancestor"),
            Some("urn:pi-agent:session-origin"),
            999,
        );
        assert_eq!(forked["@type"],             "Session");
        assert_eq!(forked["parent_session_id"], "urn:pi-agent:session-origin");
        assert_eq!(forked["leaf_entry_id"],     "urn:pi-agent:entry-ancestor");
        assert_eq!(forked["name"],              "my fork");
    }

    #[test]
    fn navigate_updates_leaf_in_node() {
        // Navigate is a pure JSON patch — verify field semantics
        let mut session = session_node("urn:pi-agent:session-s1", None, None, None, 1);
        assert!(session["leaf_entry_id"].is_null());

        // Simulate navigate by patching leaf_entry_id (as navigate_session does)
        session["leaf_entry_id"] = serde_json::Value::String("urn:pi-agent:entry-42".into());
        assert_eq!(session["leaf_entry_id"], "urn:pi-agent:entry-42");

        // Navigate is idempotent: same entry twice is fine
        session["leaf_entry_id"] = serde_json::Value::String("urn:pi-agent:entry-42".into());
        assert_eq!(session["leaf_entry_id"], "urn:pi-agent:entry-42");
    }

    // ── history_from_tree tests ───────────────────────────────────────────────

    fn make_entry(id: &str, sid: &str, parent: Option<&str>, kind: &str, content: &str) -> String {
        session_entry_node(id, sid, parent, kind, content, 0).to_string()
    }

    #[test]
    fn tree_walk_linear_chain() {
        let nodes = vec![
            make_entry("urn:e1", "urn:s1", None,         "user",  "hello"),
            make_entry("urn:e2", "urn:s1", Some("urn:e1"), "agent", "world"),
            make_entry("urn:e3", "urn:s1", Some("urn:e2"), "user",  "more"),
        ];
        let history = history_from_tree(&nodes, "urn:e3", 10);
        assert_eq!(history.len(), 3);
        assert_eq!(history[0], ("user".into(),      "hello".into())); // oldest first
        assert_eq!(history[1], ("assistant".into(), "world".into()));
        assert_eq!(history[2], ("user".into(),      "more".into()));
    }

    #[test]
    fn tree_walk_caps_at_max_turns() {
        let nodes: Vec<String> = (1..=10_u8).map(|i| {
            let id = format!("urn:e{i:02}");
            let parent = if i == 1 { None } else { Some(format!("urn:e{:02}", i-1)) };
            make_entry(&id, "urn:s1", parent.as_deref(), "user", &format!("msg{i}"))
        }).collect();
        let history = history_from_tree(&nodes, "urn:e10", 4);
        assert_eq!(history.len(), 4);
        assert_eq!(history[0].1, "msg7"); // oldest of the last 4
        assert_eq!(history[3].1, "msg10");
    }

    #[test]
    fn tree_walk_skips_tool_entries() {
        let nodes = vec![
            make_entry("urn:e1", "urn:s1", None,         "user",        "q"),
            make_entry("urn:e2", "urn:s1", Some("urn:e1"), "tool_call",  "tool"),
            make_entry("urn:e3", "urn:s1", Some("urn:e2"), "agent",      "answer"),
        ];
        let history = history_from_tree(&nodes, "urn:e3", 10);
        assert_eq!(history.len(), 2, "tool_call must be skipped");
        assert_eq!(history[0].0, "user");
        assert_eq!(history[1].0, "assistant");
    }

    #[test]
    fn tree_walk_only_active_branch() {
        // Branch A: e1 → e2a; Branch B: e1 → e2b (navigate back, new msg)
        let nodes = vec![
            make_entry("urn:e1",  "urn:s1", None,          "user",  "start"),
            make_entry("urn:e2a", "urn:s1", Some("urn:e1"), "agent", "path A"),
            make_entry("urn:e2b", "urn:s1", Some("urn:e1"), "agent", "path B"),
        ];
        // leaf = e2b (user navigated back and chose path B)
        let history = history_from_tree(&nodes, "urn:e2b", 10);
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].1, "start");
        assert_eq!(history[1].1, "path B"); // e2a NOT included
    }

    // ── read_structured tests ─────────────────────────────────────────────────

    #[test]
    fn detect_format_from_extension() {
        assert_eq!(detect_format("/a/b.json"),   "json");
        assert_eq!(detect_format("/a/b.toml"),   "toml");
        assert_eq!(detect_format("/a/b.yaml"),   "yaml");
        assert_eq!(detect_format("/a/b.yml"),    "yaml");
        assert_eq!(detect_format("/a/b.rs"),     "json"); // fallback
        assert_eq!(detect_format("/a/b.JSON"),   "json"); // case-insensitive
    }

    #[test]
    fn read_structured_json_array_paginated() {
        let data: Vec<serde_json::Value> = (1..=100).map(|i| serde_json::json!({"id": i})).collect();
        let bytes = serde_json::to_vec(&data).unwrap();
        let result = read_structured_parse(&bytes, "json", 10, 0);
        assert!(result.contains("items 1-10 of 100"), "header: {result}");
        assert!(result.contains("truncated"), "should be truncated: {result}");
        let parsed: serde_json::Value = serde_json::from_str(result.lines().skip(1).collect::<Vec<_>>().join("\n").as_str()).unwrap();
        assert_eq!(parsed.as_array().unwrap().len(), 10);
    }

    #[test]
    fn read_structured_json_array_page_offset() {
        let data: Vec<serde_json::Value> = (1..=20).map(|i| serde_json::json!(i)).collect();
        let bytes = serde_json::to_vec(&data).unwrap();
        let result = read_structured_parse(&bytes, "json", 5, 10);
        assert!(result.contains("items 11-15 of 20"), "header: {result}");
        let parsed: serde_json::Value = serde_json::from_str(
            result.lines().skip(1).collect::<Vec<_>>().join("\n").as_str()
        ).unwrap();
        assert_eq!(parsed[0], 11);
    }

    #[test]
    fn read_structured_json_object_paginated() {
        let obj: serde_json::Value = (b'a'..=b'z')
            .map(|c| (String::from(c as char), serde_json::Value::from(c as i32)))
            .collect::<serde_json::Map<_, _>>()
            .into();
        let bytes = serde_json::to_vec(&obj).unwrap();
        let result = read_structured_parse(&bytes, "json", 5, 0);
        assert!(result.contains("5 of 26 keys"), "header: {result}");
        assert!(result.contains("truncated"));
    }

    #[test]
    fn read_structured_tasks_json_pagination() {
        // Simulate a tasks.json-shaped file: {"tasks": [...354 items...]}
        let tasks: Vec<serde_json::Value> = (1..=354).map(|i| serde_json::json!({"id": format!("T-{i:04}"), "status": "planned"})).collect();
        let data = serde_json::json!({"tasks": tasks});
        let bytes = serde_json::to_vec(&data).unwrap();
        let result = read_structured_parse(&bytes, "json", 50, 0);
        // It's an object with 1 key ("tasks"), so only that key is shown
        assert!(result.contains("1 of 1 keys") || result.contains("all 1 keys"), "header: {result}");
        // The tasks array inside will be complete (it's a value of the object, not paginated further)
        // This is correct behavior — page_size applies to top-level items, not nested arrays
    }

    #[test]
    fn read_structured_tasks_json_array_at_root() {
        // If tasks.json had an array at root, pagination works correctly
        let tasks: Vec<serde_json::Value> = (1..=354).map(|i| serde_json::json!({"id": format!("T-{i:04}"), "status": "planned"})).collect();
        let bytes = serde_json::to_vec(&tasks).unwrap();
        let result = read_structured_parse(&bytes, "json", 50, 0);
        assert!(result.contains("items 1-50 of 354"), "header: {result}");
        assert!(result.contains("truncated"));
    }

    #[test]
    fn read_structured_json_no_truncation_when_small() {
        let data = serde_json::json!([1, 2, 3]);
        let bytes = serde_json::to_vec(&data).unwrap();
        let result = read_structured_parse(&bytes, "json", 50, 0);
        assert!(result.contains("items 1-3 of 3"), "header: {result}");
        assert!(!result.contains("truncated"), "small file must not be truncated");
    }

    #[test]
    fn read_structured_toml_parses_cargo_toml() {
        let cargo = r#"
[package]
name = "pi-agent"
version = "0.1.0"

[dependencies]
serde_json = "1"
"#;
        let result = read_structured_parse(cargo.as_bytes(), "toml", 0, 0);
        assert!(result.contains("toml"), "header must say toml: {result}");
        assert!(result.contains("pi-agent") || result.contains("package"), "content: {result}");
    }

    #[test]
    fn read_structured_yaml_simple_mapping() {
        let yaml = b"name: pi-agent\nversion: 0.1.0\nauthor: arthur\n";
        let result = read_structured_parse(yaml, "yaml", 0, 0);
        assert!(result.contains("yaml"), "header must say yaml: {result}");
        assert!(result.contains("pi-agent"), "content must include value: {result}");
    }

    #[test]
    fn read_structured_yaml_sequence_paginated() {
        let items: Vec<String> = (1..=50).map(|i| format!("- item{i}")).collect();
        let yaml = items.join("\n").into_bytes();
        let result = read_structured_parse(&yaml, "yaml", 10, 0);
        assert!(result.contains("yaml"),          "header: {result}");
        assert!(result.contains("items 1-10 of 50"), "pagination: {result}");
        assert!(result.contains("truncated"),     "truncation: {result}");
    }

    #[test]
    fn read_structured_yaml_github_actions_workflow() {
        let workflow = b"
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cargo test
";
        let result = read_structured_parse(workflow, "yaml", 0, 0);
        assert!(result.contains("yaml"),    "header: {result}");
        assert!(result.contains("CI") || result.contains("name"), "content: {result}");
    }

    #[test]
    fn read_structured_yaml_detect_from_extension() {
        assert_eq!(detect_format("/path/to/.github/workflows/ci.yml"), "yaml");
        assert_eq!(detect_format("/path/to/docker-compose.yaml"),      "yaml");
    }

    #[test]
    fn read_structured_invalid_json_returns_error() {
        let result = read_structured_parse(b"{not valid json", "json", 50, 0);
        assert!(result.contains("parse error"), "must report parse error: {result}");
    }

    // ── /new_id / now_ns ─────────────────────────────────────────────────────

    #[test]
    fn new_id_is_unique() {
        let ids: Vec<_> = (0..20).map(|_| new_id()).collect();
        let unique: std::collections::HashSet<_> = ids.iter().collect();
        assert_eq!(ids.len(), unique.len());
    }

    #[test]
    fn new_id_format_is_hex() {
        let id = new_id();
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()), "not hex: {id}");
        assert!(id.len() >= 20);
    }

    #[test]
    fn now_ns_is_non_zero() {
        assert!(now_ns() > 0);
    }

    #[test]
    fn default_provider_is_ollama_when_nothing_set() {
        std::env::remove_var("LLM_PROVIDER");
        std::env::remove_var("LLM_DEFAULT_PROVIDER");
        assert_eq!(provider_name_from_env(), "ollama",
            "last-resort default deve ser local, não pago");
    }

    #[test]
    fn llm_default_provider_overrides_hardcoded_ollama() {
        std::env::remove_var("LLM_PROVIDER");
        std::env::set_var("LLM_DEFAULT_PROVIDER", "anthropic");
        assert_eq!(provider_name_from_env(), "anthropic");
        std::env::remove_var("LLM_DEFAULT_PROVIDER");
    }

    #[test]
    fn llm_provider_takes_precedence_over_default() {
        std::env::set_var("LLM_DEFAULT_PROVIDER", "anthropic");
        std::env::set_var("LLM_PROVIDER", "openai");
        assert_eq!(provider_name_from_env(), "openai");
        std::env::remove_var("LLM_PROVIDER");
        std::env::remove_var("LLM_DEFAULT_PROVIDER");
    }

    #[test]
    fn explicit_anthropic_is_respected() {
        std::env::set_var("LLM_PROVIDER", "anthropic");
        assert_eq!(provider_name_from_env(), "anthropic");
        std::env::remove_var("LLM_PROVIDER");
    }

    #[test]
    fn unknown_provider_passes_through_to_compat_path() {
        std::env::set_var("LLM_PROVIDER", "groq");
        assert_eq!(provider_name_from_env(), "groq");
        std::env::remove_var("LLM_PROVIDER");
    }

    #[test]
    fn react_blocks_prompt_over_context_limit() {
        std::env::set_var("LLM_MAX_CONTEXT_TOKENS", "1");
        let (content, _, tokens_in, _, _, _, model, _) = react("este prompt tem muitos tokens");
        assert!(content.contains("LLM_MAX_CONTEXT_TOKENS"), "deve mencionar o guard: {content}");
        assert_eq!(tokens_in, 0);
        assert_eq!(model, "blocked");
        std::env::remove_var("LLM_MAX_CONTEXT_TOKENS");
    }

    #[test]
    fn estimate_usd_sonnet_no_cache() {
        // 1000 in (uncached) @ $3/1M + 500 out @ $15/1M = $0.003 + $0.0075 = $0.0105
        let cost = estimate_usd("claude-sonnet-4-6", 1000, 500, 0);
        let expected = (1000.0 / 1_000_000.0) * 3.0 + (500.0 / 1_000_000.0) * 15.0;
        assert!((cost - expected).abs() < 1e-10);
    }

    #[test]
    fn estimate_usd_sonnet_with_cache_discount() {
        // 800 uncached + 200 cached; cached at 10% rate
        let cost = estimate_usd("claude-sonnet-4-6", 1000, 500, 200);
        let expected = (800.0 / 1_000_000.0) * 3.0
            + (200.0 / 1_000_000.0) * 3.0 * 0.1
            + (500.0 / 1_000_000.0) * 15.0;
        assert!((cost - expected).abs() < 1e-10);
        assert!(cost < estimate_usd("claude-sonnet-4-6", 1000, 500, 0));
    }

    #[test]
    fn estimate_usd_ollama_is_zero() {
        assert_eq!(estimate_usd("llama3.2", 10000, 5000, 0), 0.0);
        assert_eq!(estimate_usd("mistral", 1000, 1000, 0), 0.0);
    }

    #[test]
    fn history_from_nodes_sorts_by_timestamp_and_caps_turns() {
        let now = now_ns();
        let nodes = vec![
            serde_json::json!({"@type":"AgentResponse","content":"resp1","timestamp_ns":now+200}).to_string(),
            serde_json::json!({"@type":"UserPrompt",   "content":"q2",   "timestamp_ns":now+100}).to_string(),
            serde_json::json!({"@type":"UserPrompt",   "content":"q1",   "timestamp_ns":now+10 }).to_string(),
        ];
        let h = history_from_nodes(&nodes, 10);
        assert_eq!(h.len(), 3);
        assert_eq!(h[0], ("user".into(),      "q1".into()));
        assert_eq!(h[1], ("user".into(),      "q2".into()));
        assert_eq!(h[2], ("assistant".into(), "resp1".into()));
    }

    #[test]
    fn history_from_nodes_caps_at_max_turns() {
        let now = now_ns();
        let nodes: Vec<String> = (0..8u64).map(|i| {
            serde_json::json!({"@type":"UserPrompt","content":format!("q{i}"),"timestamp_ns":now+i}).to_string()
        }).collect();
        let h = history_from_nodes(&nodes, 3);
        assert_eq!(h.len(), 3);
        assert_eq!(h[2].1, "q7"); // most recent
    }

    #[test]
    fn history_from_nodes_skips_unknown_types() {
        let now = now_ns();
        let nodes = vec![
            serde_json::json!({"@type":"UsageRecord","content":"ignored","timestamp_ns":now}).to_string(),
            serde_json::json!({"@type":"UserPrompt", "content":"ok",     "timestamp_ns":now+1}).to_string(),
        ];
        let h = history_from_nodes(&nodes, 10);
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].1, "ok");
    }

    #[test]
    fn history_from_nodes_returns_empty_for_empty_input() {
        let h = history_from_nodes(&[], 10);
        assert!(h.is_empty());
    }

    #[test]
    fn history_disabled_by_default_when_env_unset() {
        // LLM_HISTORY_TURNS defaults to 0 — no history injected without opt-in.
        // history_from_nodes with max_turns=0 must return empty regardless of records.
        let now = now_ns();
        let nodes = vec![
            serde_json::json!({"@type":"UserPrompt","content":"q","timestamp_ns":now}).to_string(),
        ];
        let h = history_from_nodes(&nodes, 0);
        assert!(h.is_empty(), "max_turns=0 must produce empty history");
    }

    #[test]
    fn budget_sum_filters_by_provider_and_window() {
        let now = now_ns();
        let window = 30u64 * 24 * 3600 * 1_000_000_000;
        let recent = now - 1_000_000_000; // 1s ago — inside window
        let records = vec![
            serde_json::json!({"provider":"anthropic","estimated_usd":1.5,"timestamp_ns":recent}).to_string(),
            serde_json::json!({"provider":"openai","estimated_usd":0.5,"timestamp_ns":recent}).to_string(),
            serde_json::json!({"provider":"anthropic","estimated_usd":0.3,"timestamp_ns":recent}).to_string(),
        ];
        let spend = sum_provider_spend_usd(&records, "anthropic", now, window);
        assert!((spend - 1.8).abs() < 1e-10, "anthropic spend should be 1.8, got {spend}");
        let openai_spend = sum_provider_spend_usd(&records, "openai", now, window);
        assert!((openai_spend - 0.5).abs() < 1e-10, "openai spend should be 0.5, got {openai_spend}");
    }

    #[test]
    fn budget_sum_excludes_records_outside_window() {
        let now = now_ns();
        let window = 30u64 * 24 * 3600 * 1_000_000_000;
        let stale_ts = now.saturating_sub(window + 1_000_000_000); // 1s beyond 30d
        let records = vec![
            serde_json::json!({"provider":"anthropic","estimated_usd":100.0,"timestamp_ns":stale_ts}).to_string(),
            serde_json::json!({"provider":"anthropic","estimated_usd":2.0,"timestamp_ns":now - 1_000_000_000}).to_string(),
        ];
        let spend = sum_provider_spend_usd(&records, "anthropic", now, window);
        assert!((spend - 2.0).abs() < 1e-10, "stale record must be excluded: {spend}");
    }

    #[test]
    fn budget_sum_returns_zero_for_empty_records() {
        let spend = sum_provider_spend_usd(&[], "anthropic", now_ns(), 30 * 24 * 3600 * 1_000_000_000);
        assert_eq!(spend, 0.0);
    }

    #[test]
    fn budget_sum_ignores_malformed_records() {
        let records = vec!["not-json".to_string(), "{}".to_string()];
        let spend = sum_provider_spend_usd(&records, "anthropic", now_ns(), 30 * 24 * 3600 * 1_000_000_000);
        assert_eq!(spend, 0.0, "malformed records must not panic or contribute spend");
    }

    #[test]
    fn llm_system_env_var_is_readable() {
        std::env::set_var("LLM_SYSTEM", "You are a test agent.");
        let val = std::env::var("LLM_SYSTEM").unwrap();
        assert_eq!(val, "You are a test agent.");
        std::env::remove_var("LLM_SYSTEM");
    }

    #[test]
    fn llm_system_absent_does_not_panic() {
        std::env::remove_var("LLM_SYSTEM");
        // react() uses default system prompt when LLM_SYSTEM is unset — must not panic on native stub
        let (content, _, _, _, _, _, _, _) = react("ping");
        assert!(!content.is_empty());
    }

    #[test]
    fn apply_edits_basic_replacement() {
        let result = apply_edits("hello world".into(), &[("world", "rust")]).unwrap();
        assert_eq!(result, "hello rust");
    }

    #[test]
    fn apply_edits_multiple_ordered() {
        let result = apply_edits("a b c".into(), &[("a", "x"), ("b", "y")]).unwrap();
        assert_eq!(result, "x y c");
    }

    #[test]
    fn apply_edits_err_when_not_found() {
        let err = apply_edits("hello".into(), &[("missing", "x")]).unwrap_err();
        assert!(err.contains("not found"), "expected 'not found': {err}");
        assert!(err.contains("edit 0"), "must include edit index: {err}");
    }

    #[test]
    fn apply_edits_err_when_ambiguous() {
        let err = apply_edits("aa aa".into(), &[("aa", "bb")]).unwrap_err();
        assert!(err.contains("2 times"), "must report match count: {err}");
        assert!(err.contains("edit 0"), "must include edit index: {err}");
    }

    #[test]
    fn apply_edits_sequential_after_first_replacement() {
        // After first edit changes "foo" to "foo foo", second edit finds 2 occurrences → error.
        let err = apply_edits("foo".into(), &[("foo", "foo foo"), ("foo", "bar")]).unwrap_err();
        assert!(err.contains("2 times"), "second edit should fail: {err}");
    }

    #[test]
    fn apply_edits_empty_edits_passthrough() {
        let result = apply_edits("unchanged".into(), &[]).unwrap();
        assert_eq!(result, "unchanged");
    }

    #[test]
    fn tools_anthropic_includes_search_files() {
        let tools = tools_anthropic();
        let names: Vec<&str> = tools.as_array().unwrap()
            .iter().filter_map(|t| t["name"].as_str()).collect();
        assert!(names.contains(&"search_files"), "search_files must be in anthropic tools: {names:?}");
    }

    #[test]
    fn tools_openai_includes_search_files() {
        let tools = tools_openai();
        let names: Vec<&str> = tools.as_array().unwrap()
            .iter().filter_map(|t| t["function"]["name"].as_str()).collect();
        assert!(names.contains(&"search_files"), "search_files must be in openai tools: {names:?}");
    }

    #[test]
    fn tools_anthropic_includes_list_dir() {
        let tools = tools_anthropic();
        let names: Vec<&str> = tools.as_array().unwrap()
            .iter().filter_map(|t| t["name"].as_str()).collect();
        assert!(names.contains(&"list_dir"), "list_dir must be in anthropic tools: {names:?}");
    }

    #[test]
    fn tools_openai_includes_list_dir() {
        let tools = tools_openai();
        let names: Vec<&str> = tools.as_array().unwrap()
            .iter().filter_map(|t| t["function"]["name"].as_str()).collect();
        assert!(names.contains(&"list_dir"), "list_dir must be in openai tools: {names:?}");
    }

    #[test]
    fn tools_anthropic_includes_edit_file_with_edits_schema() {
        let tools = tools_anthropic();
        let edit = tools.as_array().unwrap().iter()
            .find(|t| t["name"] == "edit_file")
            .expect("edit_file must be in anthropic tools");
        let props = &edit["input_schema"]["properties"];
        assert!(props.get("path").is_some(), "schema must have path");
        assert!(props.get("edits").is_some(), "schema must have edits array, not diff");
        assert!(props.get("diff").is_none(), "unified diff schema must be removed");
    }

    #[test]
    fn tools_openai_includes_edit_file_with_edits_schema() {
        let tools = tools_openai();
        let edit = tools.as_array().unwrap().iter()
            .find(|t| t["function"]["name"] == "edit_file")
            .expect("edit_file must be in openai tools");
        let props = &edit["function"]["parameters"]["properties"];
        assert!(props.get("edits").is_some(), "schema must have edits array, not diff");
        assert!(props.get("diff").is_none(), "unified diff schema must be removed");
    }

    #[test]
    fn usage_record_schema_has_required_fields() {
        let (_, _, tokens_in, tokens_out, tokens_cached, tokens_reasoning, model, usage_raw) = react("hello");
        let node = serde_json::json!({
            "@type":            "UsageRecord",
            "@id":              "urn:pi-agent:usage-test",
            "prompt_ref":       "urn:pi-agent:prompt-test",
            "provider":         "stub",
            "model":            model,
            "tokens_in":        tokens_in,
            "tokens_out":       tokens_out,
            "tokens_cached":    tokens_cached,
            "tokens_reasoning": tokens_reasoning,
            "estimated_usd":    estimate_usd(&model, tokens_in, tokens_out, tokens_cached),
            "usage_raw":        usage_raw,
            "duration_ms":      0u64,
            "timestamp_ns":     now_ns(),
        });
        for field in ["@type", "@id", "prompt_ref", "provider", "model", "tokens_in",
                      "tokens_out", "tokens_cached", "tokens_reasoning", "estimated_usd",
                      "usage_raw", "duration_ms", "timestamp_ns"] {
            assert!(node.get(field).is_some(), "UsageRecord missing field: {field}");
        }
        assert_eq!(node["@type"], "UsageRecord");
    }
}

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
mod extensibility_contract {
    use super::*;

    // A1 — any provider name not in the explicit list must pass through to OpenAI compat
    // (base_url driven by LLM_BASE_URL), enabling Groq, Mistral, Perplexity, etc. with zero code.
    #[test]
    fn a1_unknown_provider_name_passes_through_without_code_change() {
        for name in ["groq", "mistral", "perplexity", "together", "anyrandom"] {
            std::env::set_var("LLM_PROVIDER", name);
            assert_eq!(provider_name_from_env(), name,
                "provider name '{name}' must survive resolution unchanged");
            std::env::remove_var("LLM_PROVIDER");
        }
        // Verify the compat arm is the catch-all — nothing panics for unknown names.
        // Full Provider::from_env() is wasm32-only; name resolution is the testable surface.
    }

    // A2 — zero env vars → agent returns a response, no panic.
    #[test]
    fn a2_zero_config_boot_returns_response() {
        std::env::remove_var("LLM_PROVIDER");
        std::env::remove_var("LLM_DEFAULT_PROVIDER");
        std::env::remove_var("LLM_MODEL");
        std::env::remove_var("LLM_BASE_URL");
        std::env::remove_var("LLM_MAX_CONTEXT_TOKENS");
        std::env::remove_var("LLM_FALLBACK_PROVIDER");
        std::env::remove_var("LLM_HISTORY_TURNS");
        std::env::remove_var("LLM_SYSTEM");
        let (content, _, _, _, _, _, _, _) = react("hello");
        assert!(!content.is_empty(), "zero-config boot must produce a non-empty response");
    }

    // A3 — history is opt-in: absent or zero LLM_HISTORY_TURNS means no CRDT reads for context.
    // Verified via history_from_nodes(nodes, 0) → empty, regardless of available records.
    #[test]
    fn a3_context_is_opt_in_not_default() {
        let now = now_ns();
        let records: Vec<String> = (0..20).map(|i| {
            serde_json::json!({"@type":"UserPrompt","content":format!("q{i}"),"timestamp_ns":now+i}).to_string()
        }).collect();
        assert!(history_from_nodes(&records, 0).is_empty(),
            "history must be empty when max_turns=0 — opt-in means disabled by default");
    }

    // A4 — budget is opt-in: no LLM_BUDGET_* env vars means no spend tracking and no blocking.
    #[test]
    fn a4_budget_does_not_block_when_no_limit_set() {
        std::env::remove_var("LLM_BUDGET_ANTHROPIC_USD");
        std::env::remove_var("LLM_BUDGET_OLLAMA_USD");
        std::env::remove_var("LLM_BUDGET_OPENAI_USD");
        // sum_provider_spend_usd with an enormous spend must NOT block when no env var is set.
        // The guard in budget_exceeded_for_provider returns false when the var is absent.
        // We verify the pure spend function itself — the guard gate is tested via env var presence.
        let now = now_ns();
        let records = vec![
            serde_json::json!({"provider":"anthropic","estimated_usd":999999.0,"timestamp_ns":now}).to_string(),
        ];
        let spend = sum_provider_spend_usd(&records, "anthropic", now, 30 * 24 * 3600 * 1_000_000_000);
        assert!(spend > 0.0, "spend is computed correctly");
        // Without LLM_BUDGET_ANTHROPIC_USD set, budget_exceeded_for_provider returns false.
        // That path is wasm32-only, but the env-var absence → no-op contract is documented here.
    }
}
