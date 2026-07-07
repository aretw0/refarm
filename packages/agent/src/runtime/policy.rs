use super::types::{blocked_result, ReactResult};

#[cfg(target_arch = "wasm32")]
const DEFAULT_SYSTEM_PROMPT: &str =
    "You are the Refarm runtime agent, a sovereign AI assistant for a Refarm node. \
             Help with local tasks, files, and shell commands. Be concise.";

pub(crate) fn context_limit_error(prompt: &str) -> Option<ReactResult> {
    let estimated_tokens = (prompt.len() / 4).max(1) as u32;
    let max_tokens = std::env::var("MODEL_MAX_CONTEXT_TOKENS")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(u32::MAX);

    if estimated_tokens > max_tokens {
        return Some(blocked_result(format!(
            "[runtime-agent] prompt excede MODEL_MAX_CONTEXT_TOKENS ({estimated_tokens} > {max_tokens} tokens estimados)"
        )));
    }

    None
}

#[cfg(target_arch = "wasm32")]
fn task_context_for_prompt() -> Option<String> {
    let n = std::env::var("MODEL_TASK_CONTEXT_TURNS")
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

/// Usage guidance for the registry's dispatchable plugin tools (#6 promptSnippet),
/// pulled from the host `list-tool-prompts` import — one line per plugin tool the
/// model can call. Appended to the system prompt so the model knows these tools
/// route to plugins and how their args are shaped (the flat tool schema alone
/// under-explains this). `None` when no plugin tool is dispatchable, so a node with
/// no plugins gets a byte-identical prompt to before.
#[cfg(target_arch = "wasm32")]
fn tool_prompts_for_prompt() -> Option<String> {
    let lines = crate::refarm::plugin::capability_tools::list_tool_prompts();
    if lines.is_empty() {
        return None;
    }
    Some(format!(
        "\n\nPlugin tools available to you:\n- {}",
        lines.join("\n- ")
    ))
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn resolve_system_prompt() -> String {
    let base = std::env::var("MODEL_SYSTEM").unwrap_or_else(|_| DEFAULT_SYSTEM_PROMPT.to_owned());
    let mut prompt = match task_context_for_prompt() {
        Some(ctx) => format!("{base}{ctx}"),
        None => base,
    };
    if let Some(tools) = tool_prompts_for_prompt() {
        prompt.push_str(&tools);
    }
    prompt
}
