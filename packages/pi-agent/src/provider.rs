use crate::refarm::plugin::model_bridge;

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
        let explicit_model = std::env::var("MODEL_ID").unwrap_or_default();
        Self::from_provider_name_with_model(provider_name, &explicit_model)
    }

    pub fn from_provider_name_with_model(provider_name: &str, explicit_model: &str) -> Self {
        if provider_name == "anthropic" {
            return Provider::Anthropic {
                model: crate::choose_model(explicit_model, crate::ANTHROPIC_DEFAULT_MODEL),
            };
        }

        let (default_base, default_model) = crate::openai_compat_defaults(provider_name);
        let base_url = std::env::var("MODEL_BASE_URL").unwrap_or_else(|_| default_base.to_owned());
        Provider::OpenAiCompat {
            provider: provider_name.to_owned(),
            base_url,
            model: crate::choose_model(explicit_model, default_model),
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
    model_bridge::complete_http(provider, base_url, path, headers, body)
}

#[allow(dead_code)]
pub(crate) struct HostStreamResponse {
    pub final_body: Vec<u8>,
    pub last_sequence: Option<u32>,
    pub stored_chunks: u32,
}

#[allow(dead_code)]
pub(crate) struct HostStreamRequestMetadata<'a> {
    pub prompt_ref: &'a str,
    pub model: &'a str,
    pub provider_family: &'a str,
    pub last_sequence: Option<u32>,
}

#[allow(dead_code)]
pub(crate) fn http_post_stream_via_host(
    provider: &str,
    base_url: &str,
    path: &str,
    headers: &[(String, String)],
    body: &[u8],
    metadata: HostStreamRequestMetadata<'_>,
) -> Result<HostStreamResponse, String> {
    let response = model_bridge::complete_http_stream(
        provider,
        base_url,
        path,
        headers,
        body,
        &model_bridge::StreamResponseMetadata {
            prompt_ref: metadata.prompt_ref.to_owned(),
            model: metadata.model.to_owned(),
            provider_family: metadata.provider_family.to_owned(),
            last_sequence: metadata.last_sequence,
        },
    )?;
    Ok(HostStreamResponse {
        final_body: response.final_body,
        last_sequence: response.last_sequence,
        stored_chunks: response.stored_chunks,
    })
}
