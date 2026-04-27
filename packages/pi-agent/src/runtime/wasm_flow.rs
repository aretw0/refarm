use super::{
    policy::resolve_system_prompt,
    types::{error_result, ReactResult},
};

fn completion_to_react(model: String, r: crate::provider::CompletionResult) -> ReactResult {
    (
        r.content,
        r.tool_calls,
        r.tokens_in,
        r.tokens_out,
        r.tokens_cached,
        r.tokens_reasoning,
        model,
        r.usage_raw,
    )
}

fn try_fallback_completion(
    system: &str,
    messages: &[(String, String)],
    primary_err: &str,
) -> Option<ReactResult> {
    let fallback_name = std::env::var("LLM_FALLBACK_PROVIDER").ok()?;
    let fb = crate::provider::Provider::from_provider_name(&fallback_name);
    let fb_model = fb.model().to_owned();

    Some(match fb.complete(system, messages) {
        Ok(r) => completion_to_react(fb_model, r),
        Err(e) => error_result(
            format!("[pi-agent erro] primary: {primary_err}; fallback: {e}"),
            fb_model,
        ),
    })
}

pub(crate) fn run_wasm_react(prompt: &str) -> ReactResult {
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
        Ok(r) => completion_to_react(model, r),
        Err(primary_err) => {
            if let Some(fallback_result) = try_fallback_completion(system, &messages, &primary_err)
            {
                fallback_result
            } else {
                error_result(format!("[pi-agent erro] {primary_err}"), model)
            }
        }
    }
}
