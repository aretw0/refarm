use super::{prompt_persistence, react_loop::react_with_prompt_ref, streaming_sink};

/// Write the final is_final=true StreamChunk to the NDJSON stream file.
///
/// Controlled by REFARM_STREAMS_DIR env var (set by tractor-start.sh).
/// Falls back to ~/.refarm/streams/ when unset.
/// No-op if the directory cannot be created or the file cannot be written.
/// Only active in the WASM build — native builds (unit tests) are a no-op.
#[cfg(not(target_arch = "wasm32"))]
fn write_final_stream_chunk(_: &str, _: &str, _: &str, _: u32, _: u32) {}

#[cfg(target_arch = "wasm32")]
fn write_final_stream_chunk(
    prompt_ref: &str,
    content: &str,
    model: &str,
    tokens_in: u32,
    tokens_out: u32,
) {
    let streams_dir = match std::env::var("REFARM_STREAMS_DIR") {
        Ok(v) if !v.is_empty() => v,
        _ => {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
            format!("{home}/.refarm/streams")
        }
    };

    let stream_ref = format!("urn:tractor:stream:agent-response:{prompt_ref}");
    let file_path = format!("{streams_dir}/{stream_ref}.ndjson");

    if let Err(_e) = std::fs::create_dir_all(&streams_dir) {
        return;
    }

    let estimated_usd = (tokens_in as f64 * 0.000_003) + (tokens_out as f64 * 0.000_015);
    let chunk = format!(
        "{{\"stream_ref\":{stream_ref_json},\"sequence\":0,\"content\":{content_json},\"is_final\":true,\"metadata\":{{\"model\":{model_json},\"tokens_in\":{tokens_in},\"tokens_out\":{tokens_out},\"estimated_usd\":{estimated_usd:.6}}}}}\n",
        stream_ref_json = json_string(&stream_ref),
        content_json   = json_string(content),
        model_json     = json_string(model),
    );

    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .and_then(|mut f| { use std::io::Write; f.write_all(chunk.as_bytes()) });
}

fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"'  => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c    => out.push(c),
        }
    }
    out.push('"');
    out
}

pub(crate) struct PromptExecutionOutcome {
    pub content: String,
    pub model: String,
    pub provider: String,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub tokens_cached: u32,
    pub tokens_reasoning: u32,
    pub usage_raw: String,
}

pub(crate) fn execute_prompt(
    prompt: &str,
    system_override: Option<&str>,
) -> Option<PromptExecutionOutcome> {
    let Some(ctx) = prompt_persistence::store_prompt_and_open_session(prompt) else {
        return None;
    };
    let task_memory_id =
        prompt_persistence::open_prompt_task(&ctx.session_id, &ctx.prompt_ref, prompt);

    let previous_system = std::env::var("LLM_SYSTEM").ok();
    if let Some(system) = system_override {
        std::env::set_var("LLM_SYSTEM", system);
    }

    let t0 = crate::now_ns();
    let (
        content,
        tool_calls,
        tokens_in,
        tokens_out,
        tokens_cached,
        tokens_reasoning,
        model,
        usage_raw,
    ) = react_with_prompt_ref(prompt, Some(&ctx.prompt_ref));
    let duration_ms = crate::now_ns().saturating_sub(t0) / 1_000_000;
    let streaming_enabled = crate::streaming_config::stream_responses_enabled_from_env();
    let last_partial_sequence = streaming_sink::take_active_stream_last_sequence();
    let response_sequence =
        crate::streaming_chunks::final_response_sequence(streaming_enabled, last_partial_sequence);

    match (system_override, previous_system) {
        (Some(_), Some(previous)) => std::env::set_var("LLM_SYSTEM", previous),
        (Some(_), None) => std::env::remove_var("LLM_SYSTEM"),
        (None, _) => {}
    }

    prompt_persistence::store_agent_turn(
        &ctx.prompt_ref,
        &ctx.session_id,
        prompt_persistence::AgentTurnRecord {
            content: content.clone(),
            tool_calls,
            model: model.clone(),
            tokens_in,
            tokens_out,
            duration_ms,
            sequence: response_sequence,
        },
    );

    let provider_name = crate::provider_name_from_env();
    prompt_persistence::store_usage_record(
        &ctx.prompt_ref,
        prompt_persistence::UsageRecordInput {
            provider_name: provider_name.clone(),
            model: model.clone(),
            tokens_in,
            tokens_out,
            tokens_cached,
            tokens_reasoning,
            usage_raw: usage_raw.clone(),
            duration_ms,
        },
    );

    prompt_persistence::close_prompt_task(
        task_memory_id.as_deref(),
        &ctx.prompt_ref,
        &content,
        &model,
        tokens_in,
        tokens_out,
    );

    write_final_stream_chunk(&ctx.prompt_ref, &content, &model, tokens_in, tokens_out);

    Some(PromptExecutionOutcome {
        content,
        model,
        provider: provider_name,
        tokens_in,
        tokens_out,
        tokens_cached,
        tokens_reasoning,
        usage_raw,
    })
}

/// Handle a `user:prompt` event from tractor sidecar or any on_event caller.
///
/// Accepts two formats:
///   Structured JSON: `{"prompt":"...", "system":"...", "session_id":"...", "history_turns":10}`
///   Raw string: the plain prompt text (legacy / simple callers)
///
/// Session env vars are applied via EnvGuard so they are restored after the call
/// regardless of success or failure.
pub(crate) fn handle_prompt(payload: String) {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&payload) {
        if let Some(prompt) = v.get("prompt").and_then(|p| p.as_str()) {
            let system = v.get("system").and_then(|s| s.as_str());
            let session_id = v.get("session_id").and_then(|s| s.as_str()).map(|s| s.to_owned());
            let history_turns = v.get("history_turns").and_then(|n| n.as_u64()).map(|n| n as usize);
            let turns_str = history_turns.map(|n| n.to_string());
            let _session = crate::EnvGuard::maybe_set("LLM_SESSION_ID", session_id.as_deref());
            let _turns = crate::EnvGuard::maybe_set("LLM_HISTORY_TURNS", turns_str.as_deref());
            let _ = execute_prompt(prompt, system);
            return;
        }
    }
    let _ = execute_prompt(&payload, None);
}
