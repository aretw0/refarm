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
fn provider_config_openai_compat_defaults_known_provider() {
    let (base, model) = openai_compat_defaults("openai");
    assert_eq!(base, "https://api.openai.com");
    assert_eq!(model, "gpt-4o-mini");
}

#[test]
fn provider_config_openai_compat_defaults_unknown_provider_is_ollama_floor() {
    let (base, model) = openai_compat_defaults("any-random-provider");
    assert_eq!(base, "http://localhost:11434");
    assert_eq!(model, "llama3.2");
}
