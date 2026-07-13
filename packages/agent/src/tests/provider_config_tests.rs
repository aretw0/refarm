use super::*;

#[test]
fn provider_config_choose_model_prefers_explicit() {
    assert_eq!(
        choose_model("custom-model", "default-model"),
        "custom-model"
    );
}

#[test]
fn provider_config_choose_model_falls_back_to_default() {
    assert_eq!(choose_model("", "default-model"), "default-model");
}

#[test]
fn provider_config_anthropic_default_is_shared() {
    assert_eq!(ANTHROPIC_DEFAULT_MODEL, "claude-sonnet-4-6");
}

#[test]
fn provider_config_openai_compat_defaults_known_provider() {
    let cases = [
        ("openai", "https://api.openai.com", "gpt-5.5"),
        ("mistral", "https://api.mistral.ai", "mistral-medium-3-5"),
        ("xai", "https://api.x.ai", "grok-4.3"),
        ("deepseek", "https://api.deepseek.com", "deepseek-v4-flash"),
        (
            "together",
            "https://api.together.xyz",
            "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        ),
        (
            "openrouter",
            "https://openrouter.ai",
            "anthropic/claude-sonnet-4.6",
        ),
        (
            "gemini",
            "https://generativelanguage.googleapis.com",
            "gemini-3-flash-preview",
        ),
    ];

    for (provider, expected_base, expected_model) in cases {
        let (base, model) = openai_compat_defaults(provider);
        assert_eq!(base, expected_base);
        assert_eq!(model, expected_model);
    }
}

#[test]
fn provider_config_openai_compat_defaults_unknown_provider_is_ollama_floor() {
    let (base, model) = openai_compat_defaults("any-random-provider");
    assert_eq!(base, "http://localhost:11434");
    assert_eq!(model, "llama3.2");
}

// ── ADR-012: capability map + routing profiles (pure) ────────────────────────────

#[test]
fn capability_map_ranks_premium_and_local_tiers() {
    // Anthropic/OpenAI are premium; groq/gemini are cheap; unknown → local floor.
    assert_eq!(provider_capabilities("anthropic").cost_tier, CostTier::Premium);
    assert_eq!(provider_capabilities("openai").cost_tier, CostTier::Premium);
    assert_eq!(provider_capabilities("groq").cost_tier, CostTier::Cheap);
    assert_eq!(provider_capabilities("gemini").cost_tier, CostTier::Cheap);
    assert_eq!(
        provider_capabilities("some-unknown-provider").cost_tier,
        CostTier::Local
    );
}

#[test]
fn capability_map_local_floor_has_no_structured_json_but_is_tool_capable() {
    let floor = provider_capabilities("ollama");
    assert_eq!(floor.cost_tier, CostTier::Local);
    assert!(floor.tool_call, "local floor must still be usable as a route");
    assert!(
        !floor.structured_json,
        "local floor is not assumed to do reliable structured JSON"
    );
}

#[test]
fn cost_tier_as_str_is_stable() {
    assert_eq!(CostTier::Local.as_str(), "local");
    assert_eq!(CostTier::Cheap.as_str(), "cheap");
    assert_eq!(CostTier::Mid.as_str(), "mid");
    assert_eq!(CostTier::Premium.as_str(), "premium");
}

#[test]
fn known_profiles_have_candidate_lists_unknown_none() {
    assert!(profile_candidates("cheap").is_some());
    assert!(profile_candidates("balanced").is_some());
    assert!(profile_candidates("reliable").is_some());
    assert!(profile_candidates("nonsense").is_none());
}

#[test]
fn configured_providers_parses_list_and_always_includes_local_floor() {
    let set = configured_providers("anthropic, groq ,GEMINI");
    assert!(set.contains("anthropic"));
    assert!(set.contains("groq"));
    assert!(set.contains("gemini"), "list is lowercased");
    assert!(
        set.contains("ollama"),
        "keyless local floor is always implicitly configured"
    );
}

#[test]
fn configured_providers_empty_still_has_ollama() {
    let set = configured_providers("");
    assert_eq!(set.len(), 1);
    assert!(set.contains("ollama"));
}

#[test]
fn resolve_profile_picks_first_configured_candidate_best_first() {
    // reliable = [anthropic, openai, openrouter, mistral]. With only openrouter+groq
    // configured, anthropic and openai are skipped and openrouter (first configured,
    // best-first) wins.
    let configured = configured_providers("openrouter, groq");
    let (provider, caps) = resolve_profile("reliable", |p| configured.contains(p)).unwrap();
    assert_eq!(provider, "openrouter");
    assert_eq!(caps.cost_tier, CostTier::Mid);
}

#[test]
fn resolve_profile_cheap_prefers_local_floor() {
    // cheap = [ollama, groq, …]; ollama is always configured, so a bare run resolves
    // cheap to the local floor.
    let configured = configured_providers("");
    let (provider, caps) = resolve_profile("cheap", |p| configured.contains(p)).unwrap();
    assert_eq!(provider, "ollama");
    assert_eq!(caps.cost_tier, CostTier::Local);
}

#[test]
fn resolve_profile_unknown_profile_is_none() {
    let configured = configured_providers("anthropic");
    assert!(resolve_profile("nonsense", |p| configured.contains(p)).is_none());
}

#[test]
fn resolve_profile_none_configured_returns_none_so_caller_falls_through() {
    // balanced = [openrouter, mistral, groq, anthropic] — none of which the operator
    // configured, and the profile does not list ollama, so it strands → None, and the
    // route resolver falls back to the env default rather than forcing a dead route.
    let is_configured = |_p: &str| false;
    assert!(resolve_profile("balanced", is_configured).is_none());
}
