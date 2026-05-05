use super::types::{blocked_result, ReactResult};

#[cfg(target_arch = "wasm32")]
const DEFAULT_SYSTEM_PROMPT: &str =
    "You are pi-agent, a sovereign AI assistant for a Refarm node. \
             Help with local tasks, files, and shell commands. Be concise.";

pub(crate) fn context_limit_error(prompt: &str) -> Option<ReactResult> {
    let estimated_tokens = (prompt.len() / 4).max(1) as u32;
    let max_tokens = std::env::var("LLM_MAX_CONTEXT_TOKENS")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(u32::MAX);

    if estimated_tokens > max_tokens {
        return Some(blocked_result(format!(
            "[pi-agent] prompt excede LLM_MAX_CONTEXT_TOKENS ({estimated_tokens} > {max_tokens} tokens estimados)"
        )));
    }

    None
}

#[cfg(target_arch = "wasm32")]
fn task_context_for_prompt() -> Option<String> {
    let n = std::env::var("LLM_TASK_CONTEXT_TURNS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    if n == 0 {
        return None;
    }
    let raw = crate::refarm::plugin::tractor_bridge::query_nodes("Task", n as u32).ok()?;
    let tasks: Vec<serde_json::Value> = raw
        .iter()
        .filter_map(|r| serde_json::from_str(r).ok())
        .collect();
    super::task_labels::format_task_context(&tasks, n)
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn resolve_system_prompt() -> String {
    let base = std::env::var("LLM_SYSTEM").unwrap_or_else(|_| DEFAULT_SYSTEM_PROMPT.to_owned());
    match task_context_for_prompt() {
        Some(ctx) => format!("{base}{ctx}"),
        None => base,
    }
}
