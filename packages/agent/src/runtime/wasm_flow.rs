use super::{
    policy::resolve_system_prompt,
    types::{completion_result, error_result, ReactResult},
};

fn history_with_prompt(prompt: &str) -> Vec<(String, String)> {
    let mut messages = crate::query_history();
    messages.push(("user".to_owned(), prompt.to_owned()));
    // ADR-058 `on_overflow`: when a token budget is set and the history would exceed
    // it, fold the oldest turns into a structured summary instead of blowing the
    // window. Opt-in via MODEL_CONTEXT_BUDGET_TOKENS (0/unset = off) so the default
    // footprint is unchanged. The current prompt is the last pair and is preserved.
    let budget = std::env::var("MODEL_CONTEXT_BUDGET_TOKENS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);
    let result = crate::compact_history_detailed(messages, budget);
    // Record a REVERSIBLE fold for the folded turns: the summary went into the prompt,
    // but the turns stay in the CRDT, and this durable record (refs + digest, the
    // @refarm.dev/session-contract-v1 shape) lets them be reconstructed/verified later.
    // The last pair is the just-appended current prompt (not yet persisted as an entry),
    // so it is never part of the folded count. Best-effort — never blocks the turn.
    if result.folded_count > 0 {
        let _ = crate::record_context_fold(result.folded_count, result.summary.as_deref());
    }
    result.compacted
}

fn run_primary_completion(
    provider_name: &str,
    provider: &crate::provider::Provider,
    system: &str,
    messages: &[(String, String)],
) -> Result<crate::provider::CompletionResult, String> {
    if crate::budget_exceeded_for_provider(provider_name) {
        // AgentEvent: the spend guard tripped — an observer acts on cost distinctly
        // from a generic error (correlated via ambient run ctx).
        crate::agent_events::budget_blocked(provider_name);
        Err(format!(
            "[budget] MODEL_BUDGET_{}_USD exceeded — primary provider blocked",
            provider_name.to_uppercase()
        ))
    } else {
        provider.complete(system, messages)
    }
}

fn try_fallback_completion(
    system: &str,
    messages: &[(String, String)],
    primary_err: &str,
) -> Option<ReactResult> {
    let fallback_name = std::env::var("MODEL_FALLBACK_PROVIDER").ok()?;
    if crate::budget_exceeded_for_provider(&fallback_name) {
        crate::agent_events::budget_blocked(&fallback_name);
        return Some(error_result(
            format!(
                "[runtime-agent error] primary: {primary_err}; fallback: [budget] MODEL_BUDGET_{}_USD exceeded - fallback provider blocked",
                fallback_name.to_uppercase(),
            ),
            "blocked".to_owned(),
        ));
    }
    let fallback_model = std::env::var("MODEL_FALLBACK_MODEL_ID").unwrap_or_default();
    let fb =
        crate::provider::Provider::from_provider_name_with_model(&fallback_name, &fallback_model);
    let fb_model = fb.model().to_owned();
    if crate::streaming_config::stream_responses_enabled_from_env() {
        super::streaming_sink::update_active_stream_response_sink_model(&fb_model);
    }

    Some(match fb.complete(system, messages) {
        Ok(r) => completion_result(fb_model, r),
        Err(e) => {
            let msg = format!("[runtime-agent error] primary: {primary_err}; fallback: {e}");
            // AgentEvent: the run failed terminally (both providers). The failure
            // signal an operator most needs (correlated via ambient run ctx).
            crate::agent_events::error(&msg);
            error_result(msg, fb_model)
        }
    })
}

pub(crate) fn run_wasm_react_with_prompt_ref_and_route(
    prompt: &str,
    prompt_ref: Option<&str>,
    provider_override: Option<&str>,
    model_override: Option<&str>,
) -> ReactResult {
    let has_route_override = provider_override
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
        || model_override
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());
    let primary_name = provider_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(crate::provider_name_from_env);
    let explicit_model = model_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| std::env::var("MODEL_ID").unwrap_or_default());
    let prov = if has_route_override {
        crate::provider::Provider::from_provider_name_with_model(&primary_name, &explicit_model)
    } else {
        crate::provider::Provider::from_env()
    };
    let model = prov.model().to_owned();
    if crate::streaming_config::stream_responses_enabled_from_env() {
        if let Some(prompt_ref) = prompt_ref {
            super::streaming_sink::set_active_stream_response_sink(prompt_ref, &model);
        }
    }
    let system_owned = resolve_system_prompt();
    let system = system_owned.as_str();

    let messages = history_with_prompt(prompt);

    let primary_result = run_primary_completion(&primary_name, &prov, system, &messages);

    match primary_result {
        Ok(r) => completion_result(model, r),
        Err(primary_err) => {
            if let Some(fallback_result) = try_fallback_completion(system, &messages, &primary_err)
            {
                fallback_result
            } else {
                // AgentEvent: terminal failure — primary errored and no fallback ran.
                let msg = format!("[runtime-agent error] {primary_err}");
                crate::agent_events::error(&msg);
                error_result(msg, model)
            }
        }
    }
}

pub(crate) fn run_wasm_react_with_prompt_ref(
    prompt: &str,
    prompt_ref: Option<&str>,
) -> ReactResult {
    run_wasm_react_with_prompt_ref_and_route(prompt, prompt_ref, None, None)
}
