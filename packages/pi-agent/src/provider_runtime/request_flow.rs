use super::UsageTotals;

#[cfg(target_arch = "wasm32")]
use super::{AnthropicIterationPhase, OpenAiIterationPhase};

pub(crate) fn anthropic_headers() -> Vec<(String, String)> {
    vec![
        ("content-type".to_string(), "application/json".to_string()),
        ("anthropic-version".to_string(), "2023-06-01".to_string()),
    ]
}

pub(crate) fn openai_compat_headers() -> Vec<(String, String)> {
    vec![("content-type".to_string(), "application/json".to_string())]
}

pub(crate) fn openai_compat_path(provider: &str) -> &'static str {
    match provider {
        "groq" => "/openai/v1/chat/completions",
        "openrouter" => "/api/v1/chat/completions",
        "gemini" => "/v1beta/openai/chat/completions",
        _ => "/v1/chat/completions",
    }
}

pub(crate) fn build_anthropic_body(
    model: &str,
    system: &str,
    wire_msgs: &[serde_json::Value],
    tools: serde_json::Value,
) -> String {
    serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "system": system,
        "tools": tools,
        "messages": wire_msgs,
    })
    .to_string()
}

pub(crate) fn build_openai_body(
    model: &str,
    wire_msgs: &[serde_json::Value],
    tools: serde_json::Value,
) -> String {
    serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "tools": tools,
        "messages": wire_msgs,
    })
    .to_string()
}

pub(crate) fn parse_response_json(bytes: &[u8]) -> Result<serde_json::Value, String> {
    serde_json::from_slice(bytes).map_err(|e| format!("parse: {e}"))
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn execute_json_request(
    provider: &str,
    base_url: &str,
    path: &str,
    headers: &[(String, String)],
    body: &str,
) -> Result<serde_json::Value, String> {
    let bytes =
        crate::provider::http_post_via_host(provider, base_url, path, headers, body.as_bytes())?;
    parse_response_json(&bytes)
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn anthropic_iteration_response(
    model: &str,
    system: &str,
    wire_msgs: &[serde_json::Value],
    headers: &[(String, String)],
) -> Result<serde_json::Value, String> {
    let body = build_anthropic_body(model, system, wire_msgs, crate::tools_anthropic());
    execute_json_request(
        "anthropic",
        "https://api.anthropic.com",
        "/v1/messages",
        headers,
        &body,
    )
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn anthropic_iteration_response_and_phase(
    model: &str,
    system: &str,
    wire_msgs: &[serde_json::Value],
    headers: &[(String, String)],
    usage_totals: &mut UsageTotals,
) -> Result<(serde_json::Value, AnthropicIterationPhase), String> {
    iteration_response_and_phase_with(
        || anthropic_iteration_response(model, system, wire_msgs, headers),
        usage_totals,
        super::anthropic_phase_after_usage,
    )
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn openai_iteration_response(
    provider: &str,
    base_url: &str,
    model: &str,
    wire_msgs: &[serde_json::Value],
    headers: &[(String, String)],
) -> Result<serde_json::Value, String> {
    let body = build_openai_body(model, wire_msgs, crate::tools_openai());
    execute_json_request(
        provider,
        base_url,
        openai_compat_path(provider),
        headers,
        &body,
    )
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn openai_iteration_response_and_phase(
    provider: &str,
    base_url: &str,
    model: &str,
    wire_msgs: &[serde_json::Value],
    headers: &[(String, String)],
    usage_totals: &mut UsageTotals,
) -> Result<(serde_json::Value, OpenAiIterationPhase), String> {
    iteration_response_and_phase_with(
        || openai_iteration_response(provider, base_url, model, wire_msgs, headers),
        usage_totals,
        super::openai_phase_after_usage,
    )
}

pub(crate) fn iteration_response_and_phase_with<P, FR, FP>(
    mut response_fn: FR,
    usage_totals: &mut UsageTotals,
    mut phase_after_usage_fn: FP,
) -> Result<(serde_json::Value, P), String>
where
    FR: FnMut() -> Result<serde_json::Value, String>,
    FP: FnMut(&mut UsageTotals, &serde_json::Value) -> P,
{
    let response = response_fn()?;
    let phase = phase_after_usage_fn(usage_totals, &response);
    Ok((response, phase))
}
