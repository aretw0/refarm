pub(crate) fn openai_compat_path(provider: &str) -> &'static str {
    match provider {
        "openai-codex" => "/backend-api/codex/responses",
        "groq" => "/openai/v1/chat/completions",
        "openrouter" => "/api/v1/chat/completions",
        "gemini" => "/v1beta/openai/chat/completions",
        // Copilot serves the chat shape at its ROOT — no `/v1`. The host expects exactly this
        // (`known_provider_api_path`), and the two are kept in lockstep on purpose: a guest that
        // sent `/v1/chat/completions` here built a request the host refused, which is how ISS-141
        // first looked like a provider mismatch (2026-08-17).
        "github-copilot" => "/chat/completions",
        _ => "/v1/chat/completions",
    }
}
