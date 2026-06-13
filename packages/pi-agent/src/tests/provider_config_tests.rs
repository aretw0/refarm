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
