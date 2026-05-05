pub(crate) fn choose_model(explicit_model: &str, default_model: &'static str) -> String {
    if explicit_model.is_empty() {
        default_model.to_owned()
    } else {
        explicit_model.to_owned()
    }
}

pub(crate) fn openai_compat_defaults(provider: &str) -> (&'static str, &'static str) {
    match provider {
        "openai" => ("https://api.openai.com", "gpt-4o-mini"),
        "groq" => ("https://api.groq.com", "llama-3.3-70b-versatile"),
        "mistral" => ("https://api.mistral.ai", "mistral-large-latest"),
        "xai" => ("https://api.x.ai", "grok-3"),
        "deepseek" => ("https://api.deepseek.com", "deepseek-chat"),
        "together" => ("https://api.together.xyz", "meta-llama/Llama-3-70b-chat-hf"),
        "openrouter" => ("https://openrouter.ai", "anthropic/claude-sonnet-4-5"),
        "gemini" => (
            "https://generativelanguage.googleapis.com",
            "gemini-2.0-flash",
        ),
        _ => ("http://localhost:11434", "llama3.2"),
    }
}
