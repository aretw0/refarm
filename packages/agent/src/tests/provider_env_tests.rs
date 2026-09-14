use super::*;

#[test]
fn default_provider_is_ollama_floor_when_nothing_set() {
    std::env::remove_var("MODEL_PROVIDER");
    std::env::remove_var("MODEL_DEFAULT_PROVIDER");
    // Also clear MODEL_BASE_URL — env vars leak across threads in this repo, and a
    // stray value from another test could mask a regression here.
    std::env::remove_var("MODEL_BASE_URL");
    assert_eq!(
        provider_name_from_env(),
        "ollama",
        "zero-config last-resort must be the keyless ollama floor that agrees with the host"
    );
}

#[test]
fn model_default_provider_overrides_hardcoded_openai() {
    std::env::remove_var("MODEL_PROVIDER");
    std::env::set_var("MODEL_DEFAULT_PROVIDER", "anthropic");
    assert_eq!(provider_name_from_env(), "anthropic");
    std::env::remove_var("MODEL_DEFAULT_PROVIDER");
}

#[test]
fn model_provider_takes_precedence_over_default() {
    std::env::set_var("MODEL_DEFAULT_PROVIDER", "anthropic");
    std::env::set_var("MODEL_PROVIDER", "openai");
    assert_eq!(provider_name_from_env(), "openai");
    std::env::remove_var("MODEL_PROVIDER");
    std::env::remove_var("MODEL_DEFAULT_PROVIDER");
}

#[test]
fn explicit_anthropic_is_respected() {
    std::env::set_var("MODEL_PROVIDER", "anthropic");
    assert_eq!(provider_name_from_env(), "anthropic");
    std::env::remove_var("MODEL_PROVIDER");
}

#[test]
fn unknown_provider_passes_through_to_compat_path() {
    std::env::set_var("MODEL_PROVIDER", "groq");
    assert_eq!(provider_name_from_env(), "groq");
    std::env::remove_var("MODEL_PROVIDER");
}

// ── resolved_provider_name (F3, whole-branch review) ─────────────────────────

#[test]
fn resolved_provider_name_prefers_an_in_scope_override_over_the_env_default() {
    // The completion path itself gives an explicit override top precedence
    // (`wasm_flow.rs`'s `explicit_provider`) — the post-completion bookkeeping
    // (pricing_mode, estimated_usd, the provider label on the UsageRecord)
    // must agree, or the record disagrees with the provider that served it.
    std::env::set_var("MODEL_PROVIDER", "ollama");
    assert_eq!(resolved_provider_name(Some("anthropic")), "anthropic");
    std::env::remove_var("MODEL_PROVIDER");
}

#[test]
fn resolved_provider_name_falls_back_to_the_env_default_when_nothing_is_in_scope() {
    std::env::set_var("MODEL_PROVIDER", "openai-codex");
    assert_eq!(resolved_provider_name(None), "openai-codex");
    std::env::remove_var("MODEL_PROVIDER");
}
