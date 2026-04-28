mod contract_loop;
mod contracts;
mod loop_config;
mod loop_dispatch;
mod phase_primitives;
mod request_flow;
mod state_primitives;
mod tool_phase;
mod usage_finalize;
mod wasm_runners;
mod wire_bootstrap;

pub(crate) use contracts::{
    provider_iteration_contract, provider_response_phase_contract_into_parts,
    response_phase_contract_from_state_with, step_from_state_with_dispatch_contract,
    ProviderIterationContract, ProviderResponsePhaseContract,
};

pub(crate) use contract_loop::run_completion_loop_from_common_config_and_context_with_contract_primitives_and_dispatch;
pub(crate) use loop_config::{ProviderLoopPlan, ProviderLoopState, ProviderRunnerCommonConfig};
pub(crate) use loop_dispatch::run_completion_loop_from_common_config_and_context_with_dispatch;

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) use loop_config::{anthropic_runner_config, openai_runner_config};

#[cfg(target_arch = "wasm32")]
pub(crate) use loop_config::{AnthropicRunnerConfig, OpenAiRunnerConfig};

#[cfg(test)]
pub(crate) use loop_config::{
    anthropic_loop_plan, anthropic_loop_state, openai_loop_plan, openai_loop_state,
    provider_loop_plan_with_max_iter, provider_loop_state, provider_runner_common_config,
};
pub(crate) use phase_primitives::{
    anthropic_completion_text_if_terminate, anthropic_iteration_phase,
    openai_completion_text_if_terminate, openai_iteration_phase, AnthropicIterationPhase,
    OpenAiIterationPhase, ParsedAnthropicToolUse, ParsedOpenAiToolCall,
};
pub(crate) use tool_phase::{
    advance_anthropic_tool_phase_from_phase_with, advance_openai_tool_phase_from_phase_with,
};

#[cfg(test)]
pub(crate) use phase_primitives::{
    anthropic_content_array, anthropic_has_tool_calls, anthropic_text_content,
    completion_text_if_terminate, error_message, openai_choice_message, openai_has_tool_calls,
    openai_message_content, openai_tool_calls_array, parse_anthropic_tool_uses,
    parse_json_arguments, parse_openai_tool_calls, require_anthropic_text_content,
    require_openai_message_content, should_terminate_tool_loop,
};

pub(crate) use request_flow::{anthropic_headers, openai_compat_headers};
#[cfg(test)]
pub(crate) use tool_phase::{
    advance_anthropic_tool_phase_with, advance_openai_tool_phase_with, advance_tool_phase_with,
    anthropic_tool_result, append_anthropic_assistant_message,
    append_anthropic_tool_results_message, append_openai_assistant_message,
    append_openai_tool_message, append_openai_tool_messages, execute_anthropic_tools_with,
    execute_openai_tools_with, execute_tools_with, push_executed_call,
    record_anthropic_tool_execution, record_openai_tool_execution, OpenAiToolMessage,
};
pub(crate) use wire_bootstrap::{initial_anthropic_wire_messages, initial_openai_wire_messages};

#[cfg(test)]
pub(crate) use request_flow::{
    build_anthropic_body, build_openai_body, iteration_response_and_phase_with, openai_compat_path,
    parse_response_json,
};

#[cfg(target_arch = "wasm32")]
pub(crate) use request_flow::{
    anthropic_iteration_response_and_phase, openai_iteration_response_and_phase,
};

#[cfg(test)]
pub(crate) use loop_dispatch::{
    run_completion_loop_from_common_config_with_dispatch,
    run_completion_loop_from_plan_with_dispatch,
};
pub(crate) use state_primitives::run_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch;
pub(crate) use usage_finalize::UsageTotals;

#[cfg(test)]
pub(crate) use contract_loop::{
    run_completion_loop_from_common_config_and_context_with_contract_primitives,
    run_completion_loop_from_common_config_with_contract_primitives,
    run_completion_loop_from_common_config_with_contract_primitives_and_dispatch,
};
#[cfg(target_arch = "wasm32")]
pub(crate) use wasm_runners::{run_anthropic_completion_loop, run_openai_completion_loop};

#[cfg(test)]
pub(crate) use state_primitives::{
    response_and_phase_from_state_with,
    run_completion_loop_from_common_config_and_context_with_state_primitives,
    run_completion_loop_from_common_config_with_state_primitives_and_dispatch,
    step_from_state_with_dispatch,
};

#[cfg(test)]
pub(crate) use contracts::provider_response_phase_contract;

pub(crate) fn tool_loop_max_iter() -> u32 {
    std::env::var("LLM_TOOL_CALL_MAX_ITER")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(5)
}

pub(crate) fn anthropic_step_text_or_advance_with<F>(
    state: &mut ProviderLoopState,
    phase: &AnthropicIterationPhase,
    iter_idx: u32,
    max_iter: u32,
    response: &serde_json::Value,
    mut dispatch: F,
) -> Result<Option<String>, String>
where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    let dispatch_ref = &mut dispatch;
    step_text_or_advance_with(
        state,
        phase,
        iter_idx,
        max_iter,
        response,
        anthropic_completion_text_if_terminate,
        |state, phase| {
            advance_anthropic_tool_phase_from_phase_with(
                &mut state.wire_msgs,
                phase,
                &mut state.executed_calls,
                &mut state.seen_hashes,
                |name, input, seen_hashes| dispatch_ref(name, input, seen_hashes),
            );
        },
    )
}

pub(crate) fn openai_step_text_or_advance_with<F>(
    state: &mut ProviderLoopState,
    phase: &OpenAiIterationPhase,
    iter_idx: u32,
    max_iter: u32,
    response: &serde_json::Value,
    mut dispatch: F,
) -> Result<Option<String>, String>
where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    let dispatch_ref = &mut dispatch;
    step_text_or_advance_with(
        state,
        phase,
        iter_idx,
        max_iter,
        response,
        openai_completion_text_if_terminate,
        |state, phase| {
            advance_openai_tool_phase_from_phase_with(
                &mut state.wire_msgs,
                phase,
                &mut state.executed_calls,
                &mut state.seen_hashes,
                |name, input, seen_hashes| dispatch_ref(name, input, seen_hashes),
            );
        },
    )
}

pub(crate) fn step_text_or_advance_with<P, FC, FA>(
    state: &mut ProviderLoopState,
    phase: &P,
    iter_idx: u32,
    max_iter: u32,
    response: &serde_json::Value,
    mut completion_text_if_terminate_fn: FC,
    mut advance_phase_fn: FA,
) -> Result<Option<String>, String>
where
    FC: FnMut(&P, u32, u32, &serde_json::Value) -> Result<Option<String>, String>,
    FA: FnMut(&mut ProviderLoopState, &P),
{
    if let Some(text) = completion_text_if_terminate_fn(phase, iter_idx, max_iter, response)? {
        return Ok(Some(text));
    }

    advance_phase_fn(state, phase);
    Ok(None)
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn anthropic_step_from_phase_with_dispatch<D>(
    state: &mut ProviderLoopState,
    phase: &AnthropicIterationPhase,
    iter_idx: u32,
    max_iter: u32,
    response: &serde_json::Value,
    dispatch: &mut D,
) -> Result<Option<String>, String>
where
    D: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    anthropic_step_text_or_advance_with(
        state,
        phase,
        iter_idx,
        max_iter,
        response,
        |name, input, seen_hashes| dispatch(name, input, seen_hashes),
    )
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn openai_step_from_phase_with_dispatch<D>(
    state: &mut ProviderLoopState,
    phase: &OpenAiIterationPhase,
    iter_idx: u32,
    max_iter: u32,
    response: &serde_json::Value,
    dispatch: &mut D,
) -> Result<Option<String>, String>
where
    D: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    openai_step_text_or_advance_with(
        state,
        phase,
        iter_idx,
        max_iter,
        response,
        |name, input, seen_hashes| dispatch(name, input, seen_hashes),
    )
}

pub(crate) fn response_usage(response: &serde_json::Value) -> &serde_json::Value {
    &response["usage"]
}

pub(crate) fn ingest_usage_from_response_with<F>(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
    mut ingest: F,
) where
    F: FnMut(&mut UsageTotals, &serde_json::Value),
{
    ingest(totals, response_usage(response));
}

#[cfg(test)]
pub(crate) fn ingest_anthropic_usage_from_response(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
) {
    ingest_usage_from_response_with(totals, response, UsageTotals::ingest_anthropic_usage);
}

pub(crate) fn anthropic_phase_after_usage(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
) -> AnthropicIterationPhase {
    phase_after_usage_with(
        totals,
        response,
        UsageTotals::ingest_anthropic_usage,
        anthropic_iteration_phase,
    )
}

#[cfg(test)]
pub(crate) fn ingest_openai_usage_from_response(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
) {
    ingest_usage_from_response_with(totals, response, UsageTotals::ingest_openai_usage);
}

pub(crate) fn openai_phase_after_usage(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
) -> OpenAiIterationPhase {
    phase_after_usage_with(
        totals,
        response,
        UsageTotals::ingest_openai_usage,
        openai_iteration_phase,
    )
}

pub(crate) fn phase_after_usage_with<P, FU, FP>(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
    ingest_usage: FU,
    mut phase_from_response: FP,
) -> P
where
    FU: FnMut(&mut UsageTotals, &serde_json::Value),
    FP: FnMut(&serde_json::Value) -> P,
{
    ingest_usage_from_response_with(totals, response, ingest_usage);
    phase_from_response(response)
}

pub(crate) fn dedup_tool_output(
    raw: String,
    seen_hashes: &mut std::collections::HashSet<u64>,
) -> String {
    if seen_hashes.insert(crate::fnv1a_hash(&raw)) {
        raw
    } else {
        "[duplicate: same output already in this context — ask for specifics if needed]".to_string()
    }
}

pub(crate) fn dispatch_and_dedup_with<F>(
    name: &str,
    input: &serde_json::Value,
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut dispatch: F,
) -> String
where
    F: FnMut(&str, &serde_json::Value) -> String,
{
    let raw = dispatch(name, input);
    dedup_tool_output(raw, seen_hashes)
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn dispatch_tool_dedup(
    name: &str,
    input: &serde_json::Value,
    seen_hashes: &mut std::collections::HashSet<u64>,
) -> String {
    dispatch_and_dedup_with(
        name,
        input,
        seen_hashes,
        crate::tool_dispatch::dispatch_tool,
    )
}

pub(crate) fn run_completion_loop_with<P, FR, FS>(
    max_iter: u32,
    mut state: ProviderLoopState,
    mut response_and_phase: FR,
    mut step: FS,
) -> Result<CompletionLoopOutcome, String>
where
    FR: FnMut(&mut ProviderLoopState) -> Result<(serde_json::Value, P), String>,
    FS: FnMut(
        &mut ProviderLoopState,
        &P,
        u32,
        u32,
        &serde_json::Value,
    ) -> Result<Option<String>, String>,
{
    for iter_idx in 0..=max_iter {
        let (response, phase) = response_and_phase(&mut state)?;
        if let Some(text) = step(&mut state, &phase, iter_idx, max_iter, &response)? {
            return Ok(CompletionLoopOutcome {
                state,
                response,
                text,
            });
        }
    }
    unreachable!()
}

pub(crate) fn run_completion_loop_from_plan_with<P, FR, FS>(
    plan: ProviderLoopPlan,
    response_and_phase: FR,
    step: FS,
) -> Result<CompletionLoopOutcome, String>
where
    FR: FnMut(&mut ProviderLoopState) -> Result<(serde_json::Value, P), String>,
    FS: FnMut(
        &mut ProviderLoopState,
        &P,
        u32,
        u32,
        &serde_json::Value,
    ) -> Result<Option<String>, String>,
{
    run_completion_loop_with(plan.max_iter, plan.state, response_and_phase, step)
}

pub(crate) struct CompletionLoopOutcome {
    pub state: ProviderLoopState,
    pub response: serde_json::Value,
    pub text: String,
}
