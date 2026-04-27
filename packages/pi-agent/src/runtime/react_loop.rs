#[cfg(target_arch = "wasm32")]
use super::policy::resolve_system_prompt;
use super::{
    policy::context_limit_error,
    types::{error_result, ReactResult},
};

#[cfg(target_arch = "wasm32")]
fn try_fallback_completion(
    system: &str,
    messages: &[(String, String)],
    primary_err: &str,
) -> Option<ReactResult> {
    let fallback_name = std::env::var("LLM_FALLBACK_PROVIDER").ok()?;
    let original_provider = crate::provider_name_from_env();
    std::env::set_var("LLM_PROVIDER", &fallback_name);
    let fb = crate::provider::Provider::from_env();
    std::env::set_var("LLM_PROVIDER", original_provider);
    let fb_model = fb.model().to_owned();

    Some(match fb.complete(system, messages) {
        Ok(r) => (
            r.content,
            r.tool_calls,
            r.tokens_in,
            r.tokens_out,
            r.tokens_cached,
            r.tokens_reasoning,
            fb_model,
            r.usage_raw,
        ),
        Err(e) => error_result(
            format!("[pi-agent erro] primary: {primary_err}; fallback: {e}"),
            fb_model,
        ),
    })
}

/// Returns: (content, tool_calls, tokens_in, tokens_out, tokens_cached, tokens_reasoning, model_id, usage_raw)
pub(crate) fn react(prompt: &str) -> ReactResult {
    if let Some(err) = context_limit_error(prompt) {
        return err;
    }

    #[cfg(target_arch = "wasm32")]
    {
        let primary_name = crate::provider_name_from_env();
        let prov = crate::provider::Provider::from_env();
        let model = prov.model().to_owned();
        let system_owned = resolve_system_prompt();
        let system = system_owned.as_str();

        let mut messages = crate::query_history();
        messages.push(("user".to_owned(), prompt.to_owned()));

        let primary_result = if crate::budget_exceeded_for_provider(&primary_name) {
            Err(format!(
                "[budget] LLM_BUDGET_{}_USD exceeded — primary provider blocked",
                primary_name.to_uppercase()
            ))
        } else {
            prov.complete(system, &messages)
        };

        match primary_result {
            Ok(r) => (
                r.content,
                r.tool_calls,
                r.tokens_in,
                r.tokens_out,
                r.tokens_cached,
                r.tokens_reasoning,
                model,
                r.usage_raw,
            ),
            Err(primary_err) => {
                if let Some(fallback_result) =
                    try_fallback_completion(system, &messages, &primary_err)
                {
                    fallback_result
                } else {
                    error_result(format!("[pi-agent erro] {primary_err}"), model)
                }
            }
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        error_result(format!("[pi-agent stub] {prompt}"), "stub".to_owned())
    }
}
