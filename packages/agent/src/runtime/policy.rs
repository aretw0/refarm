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

/// Progressive-disclosure skill index for the system prompt (skill leg, ADR-086).
/// The host packs one disclosure line per installed skill (name + description +
/// when-to-use) into `MODEL_SKILLS`, newline-separated — the CHEAP metadata the
/// references (Codex/Hermes/Claude Skills) always keep present, WITHOUT loading the
/// full instructions. Pure + native-testable: given the raw env value, format the
/// section, or `None` when there is no skill (byte-identical prompt for a node with
/// none). Blank lines are dropped so a trailing newline never yields an empty entry.
fn skill_prompts_section(raw: &str) -> Option<String> {
    let lines: Vec<&str> = raw.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    if lines.is_empty() {
        return None;
    }
    Some(format!(
        "\n\nSkills available to you (guidance you should follow when a task matches):\n- {}",
        lines.join("\n- ")
    ))
}

#[cfg(target_arch = "wasm32")]
fn skill_prompts_for_prompt() -> Option<String> {
    std::env::var("MODEL_SKILLS")
        .ok()
        .and_then(|raw| skill_prompts_section(&raw))
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
    if let Some(skills) = skill_prompts_for_prompt() {
        prompt.push_str(&skills);
    }
    prompt
}

#[cfg(test)]
mod tests {
    use super::skill_prompts_section;

    #[test]
    fn none_when_no_skills() {
        // A node with no skills must yield NO section (byte-identical prompt).
        assert_eq!(skill_prompts_section(""), None);
        assert_eq!(skill_prompts_section("   \n  \n"), None);
    }

    #[test]
    fn formats_disclosure_lines_as_a_bulleted_section() {
        let raw = "git-workflow — commit + PR flow (use when: the task edits code and needs a PR)\nvault-search — find notes (use when: asked to locate a note)";
        let section = skill_prompts_section(raw).expect("a section for two skills");
        assert!(section.starts_with("\n\nSkills available to you"));
        assert!(section.contains("\n- git-workflow — commit + PR flow"));
        assert!(section.contains("\n- vault-search — find notes"));
    }

    #[test]
    fn drops_blank_lines_so_a_trailing_newline_is_not_an_empty_bullet() {
        let raw = "only-skill — does one thing\n";
        let section = skill_prompts_section(raw).expect("a section");
        // Exactly one bullet, no empty trailing "- ".
        assert_eq!(section.matches("\n- ").count(), 1);
    }
}
