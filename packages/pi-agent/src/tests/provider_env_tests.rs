use super::*;

#[test]
fn default_provider_is_openai_when_nothing_set() {
    std::env::remove_var("MODEL_PROVIDER");
    std::env::remove_var("MODEL_DEFAULT_PROVIDER");
    assert_eq!(
        provider_name_from_env(),
        "openai",
        "last-resort default must follow Refarm's shared model routing default"
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
