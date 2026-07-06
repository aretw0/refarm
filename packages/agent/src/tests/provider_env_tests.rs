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
