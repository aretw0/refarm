use crate::refarm::plugin::llm_bridge;

pub struct CompletionResult {
    pub content: String,
    /// Normalized log of tool calls executed during the agentic loop: [{name, input, result}]
    pub tool_calls: serde_json::Value,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub tokens_cached: u32,
    pub tokens_reasoning: u32,
    pub usage_raw: String,
}

pub enum Provider {
    Anthropic {
        model: String,
    },
    OpenAiCompat {
        provider: String,
        base_url: String,
        model: String,
    },
}

impl Provider {
    pub fn from_provider_name(provider_name: &str) -> Self {
        let explicit_model = std::env::var("LLM_MODEL").unwrap_or_default();

        if provider_name == "anthropic" {
            return Provider::Anthropic {
                model: crate::choose_model(&explicit_model, "claude-sonnet-4-6"),
            };
        }

        let (default_base, default_model) = crate::openai_compat_defaults(provider_name);
        let base_url = std::env::var("LLM_BASE_URL").unwrap_or_else(|_| default_base.to_owned());
        Provider::OpenAiCompat {
            provider: provider_name.to_owned(),
            base_url,
            model: crate::choose_model(&explicit_model, default_model),
        }
    }

    /// Build provider from env vars injected by the tractor host.
    pub fn from_env() -> Self {
        let provider_name = super::provider_name_from_env();
        Self::from_provider_name(&provider_name)
    }

    pub fn model(&self) -> &str {
        match self {
            Provider::Anthropic { model } | Provider::OpenAiCompat { model, .. } => model,
        }
    }

    /// `messages` is an ordered slice of (role, content) pairs, oldest first.
    /// The caller is responsible for appending the current user turn as the last entry.
    pub fn complete(
        &self,
        system: &str,
        messages: &[(String, String)],
    ) -> Result<CompletionResult, String> {
        match self {
            Provider::Anthropic { model } => {
                crate::provider_anthropic::complete(model, system, messages)
            }
            Provider::OpenAiCompat {
                provider,
                base_url,
                model,
            } => {
                crate::provider_openai_compat::complete(provider, base_url, model, system, messages)
            }
        }
    }
}

pub(crate) fn http_post_via_host(
    provider: &str,
    base_url: &str,
    path: &str,
    headers: &[(String, String)],
    body: &[u8],
) -> Result<Vec<u8>, String> {
    llm_bridge::complete_http(provider, base_url, path, headers, body)
}
