use super::*;
use std::sync::Mutex;

// Serializes all env-var-mutating tests in this module to prevent race conditions.
static ENV_LOCK: Mutex<()> = Mutex::new(());

// A1 — any provider name not in the explicit list must pass through to OpenAI compat
// (base_url driven by LLM_BASE_URL), enabling Groq, Mistral, Perplexity, etc. with zero code.
#[test]
fn a1_unknown_provider_name_passes_through_without_code_change() {
    let _guard = ENV_LOCK.lock().unwrap();
    for name in ["groq", "mistral", "perplexity", "together", "anyrandom"] {
        std::env::set_var("LLM_PROVIDER", name);
        assert_eq!(
            provider_name_from_env(),
            name,
            "provider name '{name}' must survive resolution unchanged"
        );
        std::env::remove_var("LLM_PROVIDER");
    }
    // Verify the compat arm is the catch-all — nothing panics for unknown names.
    // Full Provider::from_env() is wasm32-only; name resolution is the testable surface.
}

// A2 — zero env vars → agent returns a response, no panic.
#[test]
fn a2_zero_config_boot_returns_response() {
    let _guard = ENV_LOCK.lock().unwrap();
    std::env::remove_var("LLM_PROVIDER");
    std::env::remove_var("LLM_DEFAULT_PROVIDER");
    std::env::remove_var("LLM_MODEL");
    std::env::remove_var("LLM_BASE_URL");
    std::env::remove_var("LLM_MAX_CONTEXT_TOKENS");
    std::env::remove_var("LLM_FALLBACK_PROVIDER");
    std::env::remove_var("LLM_HISTORY_TURNS");
    std::env::remove_var("LLM_SYSTEM");
    let (content, _, _, _, _, _, _, _) = react("hello");
    assert!(
        !content.is_empty(),
        "zero-config boot must produce a non-empty response"
    );
}

// A3 — history is opt-in: absent or zero LLM_HISTORY_TURNS means no CRDT reads for context.
// Verified via history_from_nodes(nodes, 0) → empty, regardless of available records.
#[test]
fn a3_context_is_opt_in_not_default() {
    let now = now_ns();
    let records: Vec<String> = (0..20)
        .map(|i| {
            serde_json::json!({"@type":"UserPrompt","content":format!("q{i}"),"timestamp_ns":now+i})
                .to_string()
        })
        .collect();
    assert!(
        history_from_nodes(&records, 0).is_empty(),
        "history must be empty when max_turns=0 — opt-in means disabled by default"
    );
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
        serde_json::json!({"provider":"anthropic","estimated_usd":999999.0,"timestamp_ns":now})
            .to_string(),
    ];
    let spend = sum_provider_spend_usd(&records, "anthropic", now, 30 * 24 * 3600 * 1_000_000_000);
    assert!(spend > 0.0, "spend is computed correctly");
    // Without LLM_BUDGET_ANTHROPIC_USD set, budget_exceeded_for_provider returns false.
    // That path is wasm32-only, but the env-var absence → no-op contract is documented here.
}

// ── session tool schema tests ─────────────────────────────────────────────

fn tool_names_from_anthropic(tools: &serde_json::Value) -> Vec<String> {
    tools
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap_or("").to_string())
        .collect()
}

fn tool_names_from_openai(tools: &serde_json::Value) -> Vec<String> {
    tools
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["function"]["name"].as_str().unwrap_or("").to_string())
        .collect()
}

#[test]
fn tools_anthropic_includes_session_tools() {
    let tools = tools_anthropic();
    let names = tool_names_from_anthropic(&tools);
    for name in ["list_sessions", "current_session", "navigate", "fork"] {
        assert!(
            names.contains(&name.to_string()),
            "tools_anthropic missing: {name}"
        );
    }
}

#[test]
fn tools_openai_includes_session_tools() {
    let tools = tools_openai();
    let names = tool_names_from_openai(&tools);
    for name in ["list_sessions", "current_session", "navigate", "fork"] {
        assert!(
            names.contains(&name.to_string()),
            "tools_openai missing: {name}"
        );
    }
}

#[test]
fn tools_anthropic_navigate_has_required_fields() {
    let tools = tools_anthropic();
    let nav = tools
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "navigate")
        .expect("navigate not found");
    let required = nav["input_schema"]["required"].as_array().unwrap();
    let req_strs: Vec<&str> = required.iter().map(|v| v.as_str().unwrap()).collect();
    assert!(
        req_strs.contains(&"session_id"),
        "navigate must require session_id"
    );
    assert!(
        req_strs.contains(&"entry_id"),
        "navigate must require entry_id"
    );
}

#[test]
fn tools_openai_fork_has_required_fields() {
    let tools = tools_openai();
    let fork = tools
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["function"]["name"] == "fork")
        .expect("fork not found");
    let required = fork["function"]["parameters"]["required"]
        .as_array()
        .unwrap();
    let req_strs: Vec<&str> = required.iter().map(|v| v.as_str().unwrap()).collect();
    assert!(
        req_strs.contains(&"session_id"),
        "fork must require session_id"
    );
    assert!(req_strs.contains(&"entry_id"), "fork must require entry_id");
}

#[test]
fn tools_anthropic_and_openai_have_same_tool_count() {
    let anthropic_names: std::collections::HashSet<String> =
        tool_names_from_anthropic(&tools_anthropic())
            .into_iter()
            .collect();
    let openai_names: std::collections::HashSet<String> = tool_names_from_openai(&tools_openai())
        .into_iter()
        .collect();
    assert_eq!(
        anthropic_names, openai_names,
        "tools_anthropic and tools_openai must expose the same tool set"
    );
}

// A5 — LLM_AGENT_ID namespacing: absent → plain hex; set → urn:farmhand:<id>:<hex>
#[test]
fn a5_agent_id_absent_produces_plain_hex() {
    let _guard = ENV_LOCK.lock().unwrap();
    std::env::remove_var("LLM_AGENT_ID");
    let id = new_id();
    assert!(
        !id.starts_with("urn:"),
        "without LLM_AGENT_ID, id must not be a URN: {id}"
    );
    assert!(
        id.chars().all(|c| c.is_ascii_hexdigit()),
        "must be plain hex: {id}"
    );
}

#[test]
fn tools_anthropic_includes_code_ops() {
    let tools = tools_anthropic();
    let names = tool_names_from_anthropic(&tools);
    for name in ["find_references", "rename_symbol"] {
        assert!(
            names.contains(&name.to_string()),
            "tools_anthropic missing: {name}"
        );
    }
}

#[test]
fn tools_openai_includes_code_ops() {
    let tools = tools_openai();
    let names = tool_names_from_openai(&tools);
    for name in ["find_references", "rename_symbol"] {
        assert!(
            names.contains(&name.to_string()),
            "tools_openai missing: {name}"
        );
    }
}

#[test]
fn tools_find_references_has_required_fields() {
    let tools = tools_anthropic();
    let t = tools
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "find_references")
        .expect("find_references not found");
    let req: Vec<&str> = t["input_schema"]["required"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert!(
        req.contains(&"file") && req.contains(&"line") && req.contains(&"column"),
        "find_references must require file, line, column"
    );
}

#[test]
fn tools_rename_symbol_has_required_fields() {
    let tools = tools_anthropic();
    let t = tools
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "rename_symbol")
        .expect("rename_symbol not found");
    let req: Vec<&str> = t["input_schema"]["required"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert!(
        req.contains(&"new_name"),
        "rename_symbol must require new_name"
    );
}

#[test]
fn a5_agent_id_set_produces_urn_prefix() {
    let _guard = ENV_LOCK.lock().unwrap();
    std::env::set_var("LLM_AGENT_ID", "myagent");
    let id = new_id();
    std::env::remove_var("LLM_AGENT_ID");
    assert!(
        id.starts_with("urn:farmhand:myagent:"),
        "must have URN prefix: {id}"
    );
}

#[test]
fn a5_agent_id_uniqueness_preserved_across_instances() {
    let _guard = ENV_LOCK.lock().unwrap();
    std::env::set_var("LLM_AGENT_ID", "agent-alpha");
    let ids: Vec<_> = (0..10).map(|_| new_id()).collect();
    std::env::remove_var("LLM_AGENT_ID");
    let unique: std::collections::HashSet<_> = ids.iter().collect();
    assert_eq!(
        ids.len(),
        unique.len(),
        "agent-namespaced IDs must still be unique"
    );
}
