use super::*;

#[test]
fn default_provider_is_ollama_when_nothing_set() {
    std::env::remove_var("LLM_PROVIDER");
    std::env::remove_var("LLM_DEFAULT_PROVIDER");
    assert_eq!(
        provider_name_from_env(),
        "ollama",
        "last-resort default deve ser local, não pago"
    );
}

#[test]
fn llm_default_provider_overrides_hardcoded_ollama() {
    std::env::remove_var("LLM_PROVIDER");
    std::env::set_var("LLM_DEFAULT_PROVIDER", "anthropic");
    assert_eq!(provider_name_from_env(), "anthropic");
    std::env::remove_var("LLM_DEFAULT_PROVIDER");
}

#[test]
fn llm_provider_takes_precedence_over_default() {
    std::env::set_var("LLM_DEFAULT_PROVIDER", "anthropic");
    std::env::set_var("LLM_PROVIDER", "openai");
    assert_eq!(provider_name_from_env(), "openai");
    std::env::remove_var("LLM_PROVIDER");
    std::env::remove_var("LLM_DEFAULT_PROVIDER");
}

#[test]
fn explicit_anthropic_is_respected() {
    std::env::set_var("LLM_PROVIDER", "anthropic");
    assert_eq!(provider_name_from_env(), "anthropic");
    std::env::remove_var("LLM_PROVIDER");
}

#[test]
fn unknown_provider_passes_through_to_compat_path() {
    std::env::set_var("LLM_PROVIDER", "groq");
    assert_eq!(provider_name_from_env(), "groq");
    std::env::remove_var("LLM_PROVIDER");
}

