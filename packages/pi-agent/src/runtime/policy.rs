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
pub(crate) fn resolve_system_prompt() -> String {
    std::env::var("LLM_SYSTEM").unwrap_or_else(|_| DEFAULT_SYSTEM_PROMPT.to_owned())
}
