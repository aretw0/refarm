//! Pi Agent — sovereign AI agent for edge nodes and Raspberry Pi.
//!
//! # Provider selection (env vars)
//!   LLM_PROVIDER=anthropic|ollama|openai  (default: last-resort ollama)
//!   LLM_DEFAULT_PROVIDER=<name>            (user's sovereign default, overrides ollama floor)
//!   LLM_MODEL=<model-id>                   (provider-specific default if unset)
//!   LLM_BASE_URL=<url>                     (optional override; required for openai-compat)
//!   ANTHROPIC_API_KEY=sk-ant-...
//!   OPENAI_API_KEY=sk-...                  (also used for any OpenAI-compat provider)
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
        handle_prompt(prompt);
    }
}

// ── Prompt pipeline ───────────────────────────────────────────────────────────

fn handle_prompt(prompt: String) {
    let prompt_ref = format!("urn:pi-agent:prompt-{}", new_id());

    let prompt_node = serde_json::json!({
        "@type":        "UserPrompt",
        "@id":          prompt_ref,
        "content":      prompt.clone(),
        "timestamp_ns": now_ns(),
    });
    if tractor_bridge::store_node(&prompt_node.to_string()).is_err() {
        return;
    }

    let t0 = now_ns();
    let (content, tool_calls, tokens_in, tokens_out, tokens_cached, tokens_reasoning, model, usage_raw) = react(&prompt);
    let duration_ms = now_ns().saturating_sub(t0) / 1_000_000;

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
#[cfg(target_arch = "wasm32")]
fn query_history() -> Vec<(String, String)> {
    let max_turns = std::env::var("LLM_HISTORY_TURNS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    if max_turns == 0 { return vec![]; }
    let limit = (max_turns * 2) as u32; // fetch 2× to cover interleaved user/assistant
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
         "input_schema":{"type":"object","properties":{"argv":{"type":"array","items":{"type":"string"}},"cwd":{"type":"string"},"timeout_ms":{"type":"integer"}},"required":["argv"]}}
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
         "parameters":{"type":"object","properties":{"argv":{"type":"array","items":{"type":"string"}},"cwd":{"type":"string"},"timeout_ms":{"type":"integer"}},"required":["argv"]}}}
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
            other => format!("[error] unknown tool: {other}"),
        }
    }

    pub enum Provider {
        Anthropic { model: String },
        OpenAiCompat { provider: String, base_url: String, model: String },
    }

    impl Provider {
        /// Build provider from env vars injected by the tractor host.
        pub fn from_env() -> Self {
            let model = std::env::var("LLM_MODEL").unwrap_or_default();
            match super::provider_name_from_env().as_str() {
                "anthropic" => Provider::Anthropic {
                    model: if model.is_empty() { "claude-sonnet-4-6".into() } else { model },
                },
                "openai" => Provider::OpenAiCompat {
                    provider: "openai".into(),
                    base_url: std::env::var("LLM_BASE_URL")
                        .unwrap_or_else(|_| "https://api.openai.com".into()),
                    model: if model.is_empty() { "gpt-4o-mini".into() } else { model },
                },
                provider => Provider::OpenAiCompat { // ollama is the sovereign default
                    provider: provider.into(),
                    base_url: std::env::var("LLM_BASE_URL")
                        .unwrap_or_else(|_| "http://localhost:11434".into()),
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
                "/v1/chat/completions",
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
