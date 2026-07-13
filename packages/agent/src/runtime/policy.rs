use super::types::{blocked_result, ReactResult};

#[cfg(target_arch = "wasm32")]
const DEFAULT_SYSTEM_PROMPT: &str =
    "You are the Refarm runtime agent, a sovereign AI assistant for a Refarm node. \
             Help with local tasks, files, and shell commands. Be concise. \
             For a multi-step task, use the update_plan tool to keep a short checklist \
             and update it as you make progress; skip it for trivial single-step tasks.";

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
    let raw = crate::plugin::host::tractor_bridge::query_nodes("Task", n as u32).ok()?;
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
    let lines = crate::plugin::host::capability_tools::list_tool_prompts();
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
        "\n\nSkills available to you — when a task matches one, call the `load_skill` \
         tool with its name to load the full instructions, then follow them:\n- {}",
        lines.join("\n- ")
    ))
}

// Not wasm-gated: unlike `tool_prompts_for_prompt` (which imports the WIT
// `list-tool-prompts`), skills arrive purely via the `MODEL_SKILLS` env the host
// packs — so the whole env→section path is native-testable (the seam proof).
fn skill_prompts_for_prompt() -> Option<String> {
    std::env::var("MODEL_SKILLS")
        .ok()
        .and_then(|raw| skill_prompts_section(&raw))
}

/// Resolve the full instructions for the skill named `name` from the
/// `MODEL_SKILL_BODIES` JSON map (skill name → SKILL.md instructions) — the second
/// jump of progressive disclosure, the payload the `load_skill` tool returns. Lives
/// beside the skill INDEX (`skill_prompts_section`) it complements, and is PURE over
/// the map + name so it is native-testable, the same seam the index uses (the wasm
/// `tool_dispatch::skill_tools::load_skill` wrapper only supplies the env). Returns a
/// legible, actionable message on a miss (an unknown name lists what IS available so
/// the model can correct in-loop).
pub(crate) fn resolve_skill_body(bodies_json: &str, name: &str) -> String {
    let name = name.trim();
    if name.is_empty() {
        return "[error] load_skill requires a `name` (the skill to load, from the skills list)"
            .to_string();
    }
    let Ok(map) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(bodies_json)
    else {
        // No map (env unset/empty/malformed) → no skills are loadable here.
        return format!("[no skill named '{name}' — no skills are available to load]");
    };
    if let Some(body) = map.get(name).and_then(|v| v.as_str()) {
        return body.to_string();
    }
    // Case-insensitive second chance: a slightly-off name still resolves rather than
    // failing the turn (mirrors the delegate's forgiving persona lookup).
    let lower = name.to_ascii_lowercase();
    if let Some(body) = map
        .iter()
        .find(|(k, _)| k.to_ascii_lowercase() == lower)
        .and_then(|(_, v)| v.as_str())
    {
        return body.to_string();
    }
    let mut available: Vec<&str> = map.keys().map(String::as_str).collect();
    available.sort_unstable();
    if available.is_empty() {
        format!("[no skill named '{name}' — no skills are available to load]")
    } else {
        format!(
            "[no skill named '{name}'. Available skills: {}]",
            available.join(", ")
        )
    }
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

    #[test]
    fn reads_model_skills_env_end_to_end() {
        // The seam proof: a skill packed into MODEL_SKILLS (as the host does) reaches
        // the system-prompt section (as the agent renders it). MODEL_SKILLS is touched
        // by no other test.
        std::env::set_var("MODEL_SKILLS", "deploy-runbook — how to ship. Use when releasing.");
        let section = super::skill_prompts_for_prompt().expect("env-fed section");
        assert!(section.contains("deploy-runbook — how to ship"));
        std::env::remove_var("MODEL_SKILLS");
        assert_eq!(super::skill_prompts_for_prompt(), None);
    }

    // ── resolve_skill_body (the load_skill payload) ─────────────────────────────
    use super::resolve_skill_body;

    // Built with serde so the JSON escaping is exact (the bodies contain '#' and
    // newlines, which a hand-written raw string makes easy to get wrong).
    fn bodies() -> String {
        serde_json::json!({
            "pdf-fill": "# Fill a PDF\nUse pdftk...",
            "git-triage": "# Triage\nStart with git log",
        })
        .to_string()
    }

    #[test]
    fn loads_a_known_skill_body() {
        assert_eq!(resolve_skill_body(&bodies(), "pdf-fill"), "# Fill a PDF\nUse pdftk...");
    }

    #[test]
    fn resolve_is_case_insensitive_on_a_near_miss() {
        assert_eq!(resolve_skill_body(&bodies(), "Git-Triage"), "# Triage\nStart with git log");
    }

    #[test]
    fn unknown_skill_lists_what_is_available() {
        let out = resolve_skill_body(&bodies(), "ghost");
        assert!(out.contains("no skill named 'ghost'"));
        assert!(out.contains("git-triage") && out.contains("pdf-fill"));
    }

    #[test]
    fn empty_name_is_an_actionable_error() {
        assert!(resolve_skill_body(&bodies(), "   ").contains("requires a `name`"));
    }

    #[test]
    fn no_map_means_nothing_loadable() {
        assert!(resolve_skill_body("", "pdf-fill").contains("no skills are available"));
        assert!(resolve_skill_body("not json", "pdf-fill").contains("no skills are available"));
    }

    #[test]
    fn resolve_trims_the_requested_name() {
        assert_eq!(resolve_skill_body(&bodies(), "  pdf-fill  "), "# Fill a PDF\nUse pdftk...");
    }
}
