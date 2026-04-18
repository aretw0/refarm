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
            required_capabilities: vec!["agent-fs".to_string(), "agent-shell".to_string()],
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
        "@type": "UserPrompt",
        "@id":   prompt_ref,
        "content": prompt.clone(),
    });
    if tractor_bridge::store_node(&prompt_node.to_string()).is_err() {
        return;
    }

    let t0 = now_ns();
    let (content, tool_calls, tokens_in, tokens_out, tokens_cached, tokens_reasoning, model, usage_raw) = react(&prompt);
    let duration_ms = now_ns().saturating_sub(t0) / 1_000_000;

    let response = serde_json::json!({
        "@type":      "AgentResponse",
        "@id":        format!("urn:pi-agent:resp-{}", new_id()),
        "prompt_ref": prompt_ref,
        "content":    content,
        "sequence":   0,
        "is_final":   true,
        "tool_calls": tool_calls,
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
        const SYSTEM: &str =
            "You are pi-agent, a sovereign AI assistant for a Refarm node. \
             Help with local tasks, files, and shell commands. Be concise.";
        let primary_result = if budget_exceeded_for_provider(&primary_name) {
            Err(format!(
                "[budget] LLM_BUDGET_{}_USD exceeded — primary provider blocked",
                primary_name.to_uppercase()
            ))
        } else {
            prov.complete(SYSTEM, prompt)
        };
        match primary_result {
            Ok(r) => (r.content, serde_json::json!([]), r.tokens_in, r.tokens_out,
                      r.tokens_cached, r.tokens_reasoning, model, r.usage_raw),
            Err(primary_err) => {
                if let Ok(fallback_name) = std::env::var("LLM_FALLBACK_PROVIDER") {
                    let original_provider = provider_name_from_env();
                    std::env::set_var("LLM_PROVIDER", &fallback_name);
                    let fb = provider::Provider::from_env();
                    std::env::set_var("LLM_PROVIDER", original_provider);
                    let fb_model = fb.model().to_owned();
                    match fb.complete(SYSTEM, prompt) {
                        Ok(r) => (r.content, serde_json::json!([]), r.tokens_in, r.tokens_out,
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

#[cfg(target_arch = "wasm32")]
mod provider {
    use wasi::http::outgoing_handler;
    use wasi::http::types::{Fields, IncomingBody, Method, OutgoingBody, OutgoingRequest, Scheme};
    use wasi::io::streams::StreamError;

    pub struct CompletionResult {
        pub content: String,
        pub tokens_in: u32,
        pub tokens_out: u32,
        pub tokens_cached: u32,
        pub tokens_reasoning: u32,
        pub usage_raw: String,
    }

    pub enum Provider {
        Anthropic { api_key: String, model: String },
        OpenAiCompat { base_url: String, api_key: String, model: String },
    }

    impl Provider {
        /// Build provider from env vars injected by the tractor host.
        pub fn from_env() -> Self {
            let model = std::env::var("LLM_MODEL").unwrap_or_default();
            match super::provider_name_from_env().as_str() {
                "anthropic" => Provider::Anthropic {
                    api_key: std::env::var("ANTHROPIC_API_KEY").unwrap_or_default(),
                    model: if model.is_empty() { "claude-sonnet-4-6".into() } else { model },
                },
                "openai" => Provider::OpenAiCompat {
                    base_url: std::env::var("LLM_BASE_URL")
                        .unwrap_or_else(|_| "https://api.openai.com".into()),
                    api_key: std::env::var("OPENAI_API_KEY").unwrap_or_default(),
                    model: if model.is_empty() { "gpt-4o-mini".into() } else { model },
                },
                _ => Provider::OpenAiCompat { // ollama is the sovereign default
                    base_url: std::env::var("LLM_BASE_URL")
                        .unwrap_or_else(|_| "http://localhost:11434".into()),
                    api_key: String::new(),
                    model: if model.is_empty() { "llama3.2".into() } else { model },
                },
            }
        }

        pub fn model(&self) -> &str {
            match self { Provider::Anthropic { model, .. } | Provider::OpenAiCompat { model, .. } => model }
        }

        pub fn complete(&self, system: &str, prompt: &str) -> Result<CompletionResult, String> {
            match self {
                Provider::Anthropic { api_key, model } => {
                    if api_key.is_empty() {
                        return Err("ANTHROPIC_API_KEY not set".into());
                    }
                    anthropic(api_key, model, system, prompt)
                }
                Provider::OpenAiCompat { base_url, api_key, model } => {
                    openai_compat(base_url, api_key, model, system, prompt)
                }
            }
        }
    }

    // ── Anthropic wire format ─────────────────────────────────────────────────

    fn anthropic(api_key: &str, model: &str, system: &str, prompt: &str) -> Result<CompletionResult, String> {
        let body = serde_json::json!({
            "model": model, "max_tokens": 1024, "system": system,
            "messages": [{"role": "user", "content": prompt}],
        }).to_string();

        let bytes = http_post(
            "https://api.anthropic.com", "/v1/messages",
            &[("content-type", "application/json"), ("x-api-key", api_key),
              ("anthropic-version", "2023-06-01")],
            body.as_bytes(),
        )?;

        let v: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| format!("parse: {e}"))?;
        let content = v["content"][0]["text"].as_str()
            .ok_or_else(|| v["error"]["message"].as_str().unwrap_or("unexpected").to_owned())?
            .to_owned();
        let usage = &v["usage"];
        Ok(CompletionResult {
            content,
            tokens_in:        usage["input_tokens"].as_u64().unwrap_or(0) as u32,
            tokens_out:       usage["output_tokens"].as_u64().unwrap_or(0) as u32,
            tokens_cached:    (usage["cache_read_input_tokens"].as_u64().unwrap_or(0)
                              + usage["cache_creation_input_tokens"].as_u64().unwrap_or(0)) as u32,
            tokens_reasoning: 0,
            usage_raw:        usage.to_string(),
        })
    }

    // ── OpenAI-compatible wire format (covers Ollama, OpenAI, Groq, etc.) ─────

    fn openai_compat(base_url: &str, api_key: &str, model: &str, system: &str, prompt: &str) -> Result<CompletionResult, String> {
        let body = serde_json::json!({
            "model": model, "max_tokens": 1024,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        }).to_string();

        let auth = if !api_key.is_empty() { format!("Bearer {api_key}") } else { String::new() };
        let mut hdrs: Vec<(&str, &str)> = vec![("content-type", "application/json")];
        if !auth.is_empty() { hdrs.push(("authorization", &auth)); }

        let bytes = http_post(base_url, "/v1/chat/completions", &hdrs, body.as_bytes())?;

        let v: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| format!("parse: {e}"))?;
        let content = v["choices"][0]["message"]["content"].as_str()
            .ok_or_else(|| v["error"]["message"].as_str().unwrap_or("unexpected").to_owned())?
            .to_owned();
        let usage = &v["usage"];
        Ok(CompletionResult {
            content,
            tokens_in:        usage["prompt_tokens"].as_u64().unwrap_or(0) as u32,
            tokens_out:       usage["completion_tokens"].as_u64().unwrap_or(0) as u32,
            tokens_cached:    usage["prompt_tokens_details"]["cached_tokens"].as_u64().unwrap_or(0) as u32,
            tokens_reasoning: usage["completion_tokens_details"]["reasoning_tokens"].as_u64().unwrap_or(0) as u32,
            usage_raw:        usage.to_string(),
        })
    }

    // ── HTTP primitives ───────────────────────────────────────────────────────

    /// POST to `base_url + path`. `base_url` must be "https://host" or "http://host:port".
    fn http_post(base_url: &str, path: &str, headers: &[(&str, &str)], body: &[u8]) -> Result<Vec<u8>, String> {
        let (scheme, authority) = parse_base_url(base_url)?;

        let hdrs = Fields::new();
        for (name, value) in headers {
            hdrs.append(&name.to_string(), &value.as_bytes().to_vec())
                .map_err(|e| format!("header '{name}': {e:?}"))?;
        }

        let req = OutgoingRequest::new(hdrs);
        req.set_method(&Method::Post).map_err(|_| "set method")?;
        req.set_scheme(Some(&scheme)).map_err(|_| "set scheme")?;
        req.set_authority(Some(&authority)).map_err(|_| "set authority")?;
        req.set_path_with_query(Some(path)).map_err(|_| "set path")?;

        // write body
        let ob = req.body().map_err(|_| "outgoing body")?;
        {
            let stream = ob.write().map_err(|_| "write stream")?;
            let mut off = 0;
            while off < body.len() {
                let n = stream.check_write().map_err(|e| format!("check_write: {e:?}"))? as usize;
                if n == 0 { stream.subscribe().block(); continue; }
                let end = std::cmp::min(off + n, body.len());
                stream.write(&body[off..end]).map_err(|e| format!("write: {e:?}"))?;
                off = end;
            }
            stream.flush().ok();
            stream.subscribe().block();
        }
        OutgoingBody::finish(ob, None).map_err(|e| format!("finish: {e:?}"))?;

        // send
        let fut = outgoing_handler::handle(req, None).map_err(|e| format!("handle: {e:?}"))?;
        fut.subscribe().block();

        let incoming = fut.get()
            .ok_or("no future response")?
            .map_err(|()| "response already consumed")?
            .map_err(|e| format!("http error: {e:?}"))?;

        let status = incoming.status();
        let resp = read_body(incoming.consume().map_err(|_| "consume body")?)?;

        if !(200..300).contains(&status) {
            return Err(format!("HTTP {status}: {}", String::from_utf8_lossy(&resp)));
        }
        Ok(resp)
    }

    fn read_body(ib: IncomingBody) -> Result<Vec<u8>, String> {
        let stream = ib.stream().map_err(|_| "incoming body stream")?;
        let mut buf = Vec::new();
        loop {
            stream.subscribe().block();
            match stream.read(65536) {
                Ok(chunk) => buf.extend_from_slice(&chunk),
                Err(StreamError::Closed) => break,
                Err(StreamError::LastOperationFailed(e)) => return Err(format!("read: {e:?}")),
            }
        }
        Ok(buf)
    }

    fn parse_base_url(url: &str) -> Result<(Scheme, String), String> {
        if let Some(rest) = url.strip_prefix("https://") {
            Ok((Scheme::Https, rest.to_owned()))
        } else if let Some(rest) = url.strip_prefix("http://") {
            Ok((Scheme::Http, rest.to_owned()))
        } else {
            Err(format!("unsupported URL scheme in: {url}"))
        }
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
