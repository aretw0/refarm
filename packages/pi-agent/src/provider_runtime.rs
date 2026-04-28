mod contract_loop;
mod contracts;
mod loop_dispatch;
mod phase_primitives;
mod request_flow;
mod state_primitives;
mod usage_finalize;
mod wasm_runners;
mod wire_bootstrap;

pub(crate) use contracts::{
    provider_iteration_contract, provider_response_phase_contract_into_parts,
    response_phase_contract_from_state_with, step_from_state_with_dispatch_contract,
    ProviderIterationContract, ProviderResponsePhaseContract,
};

pub(crate) use contract_loop::run_completion_loop_from_common_config_and_context_with_contract_primitives_and_dispatch;
pub(crate) use loop_dispatch::run_completion_loop_from_common_config_and_context_with_dispatch;
pub(crate) use phase_primitives::{
    anthropic_completion_text_if_terminate, anthropic_iteration_phase,
    openai_completion_text_if_terminate, openai_iteration_phase, AnthropicIterationPhase,
    OpenAiIterationPhase, ParsedAnthropicToolUse, ParsedOpenAiToolCall,
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

pub(crate) struct ProviderLoopState {
    pub wire_msgs: Vec<serde_json::Value>,
    pub usage_totals: UsageTotals,
    pub executed_calls: Vec<serde_json::Value>,
    pub seen_hashes: std::collections::HashSet<u64>,
}

pub(crate) struct ProviderLoopPlan {
    pub max_iter: u32,
    pub state: ProviderLoopState,
}

pub(crate) struct ProviderRunnerCommonConfig<'a> {
    pub model: &'a str,
    pub headers: Vec<(String, String)>,
    pub plan: ProviderLoopPlan,
}

pub(crate) struct AnthropicRunnerConfig<'a> {
    pub common: ProviderRunnerCommonConfig<'a>,
    pub system: &'a str,
}

pub(crate) struct OpenAiRunnerConfig<'a> {
    pub common: ProviderRunnerCommonConfig<'a>,
    pub provider: &'a str,
    pub base_url: &'a str,
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn provider_runner_common_config<'a>(
    model: &'a str,
    headers: Vec<(String, String)>,
    plan: ProviderLoopPlan,
) -> ProviderRunnerCommonConfig<'a> {
    ProviderRunnerCommonConfig {
        model,
        headers,
        plan,
    }
}

pub(crate) fn provider_loop_state(initial_wire_msgs: Vec<serde_json::Value>) -> ProviderLoopState {
    ProviderLoopState {
        wire_msgs: initial_wire_msgs,
        usage_totals: UsageTotals::default(),
        executed_calls: Vec::new(),
        seen_hashes: std::collections::HashSet::new(),
    }
}

#[cfg(test)]
pub(crate) fn provider_loop_plan_with_max_iter(
    initial_wire_msgs: Vec<serde_json::Value>,
    max_iter: u32,
) -> ProviderLoopPlan {
    ProviderLoopPlan {
        max_iter,
        state: provider_loop_state(initial_wire_msgs),
    }
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn anthropic_loop_state(messages: &[(String, String)]) -> ProviderLoopState {
    provider_loop_state(initial_anthropic_wire_messages(messages))
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn anthropic_loop_plan(messages: &[(String, String)]) -> ProviderLoopPlan {
    ProviderLoopPlan {
        max_iter: tool_loop_max_iter(),
        state: anthropic_loop_state(messages),
    }
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn openai_loop_state(system: &str, messages: &[(String, String)]) -> ProviderLoopState {
    provider_loop_state(initial_openai_wire_messages(system, messages))
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn openai_loop_plan(system: &str, messages: &[(String, String)]) -> ProviderLoopPlan {
    ProviderLoopPlan {
        max_iter: tool_loop_max_iter(),
        state: openai_loop_state(system, messages),
    }
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn anthropic_runner_config<'a>(
    model: &'a str,
    system: &'a str,
    messages: &[(String, String)],
) -> AnthropicRunnerConfig<'a> {
    AnthropicRunnerConfig {
        common: provider_runner_common_config(
            model,
            anthropic_headers(),
            anthropic_loop_plan(messages),
        ),
        system,
    }
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn openai_runner_config<'a>(
    provider: &'a str,
    base_url: &'a str,
    model: &'a str,
    system: &str,
    messages: &[(String, String)],
) -> OpenAiRunnerConfig<'a> {
    OpenAiRunnerConfig {
        common: provider_runner_common_config(
            model,
            openai_compat_headers(),
            openai_loop_plan(system, messages),
        ),
        provider,
        base_url,
    }
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

pub(crate) fn anthropic_tool_result(tool_use_id: &str, content: String) -> serde_json::Value {
    serde_json::json!({
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": content,
    })
}

pub(crate) fn record_anthropic_tool_execution(
    executed_calls: &mut Vec<serde_json::Value>,
    tool_use: &ParsedAnthropicToolUse,
    result: &str,
) -> serde_json::Value {
    push_executed_call(
        executed_calls,
        &tool_use.name,
        tool_use.input.clone(),
        result,
    );
    anthropic_tool_result(&tool_use.id, result.to_owned())
}

pub(crate) fn record_openai_tool_execution(
    executed_calls: &mut Vec<serde_json::Value>,
    tool_call: &ParsedOpenAiToolCall,
    result: &str,
) {
    push_executed_call(
        executed_calls,
        &tool_call.name,
        tool_call.input.clone(),
        result,
    );
}

pub(crate) fn execute_tools_with<T, R, FD, FR>(
    calls: &[T],
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut dispatch_for_call: FD,
    mut map_result: FR,
) -> Vec<R>
where
    FD: FnMut(&T, &mut std::collections::HashSet<u64>) -> String,
    FR: FnMut(&T, String) -> R,
{
    let mut out = Vec::with_capacity(calls.len());
    for call in calls {
        let result = dispatch_for_call(call, seen_hashes);
        out.push(map_result(call, result));
    }
    out
}

pub(crate) fn execute_anthropic_tools_with<F>(
    tool_uses: &[ParsedAnthropicToolUse],
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut dispatch: F,
) -> Vec<serde_json::Value>
where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    execute_tools_with(
        tool_uses,
        seen_hashes,
        |tc, seen| dispatch(&tc.name, &tc.input, seen),
        |tc, result| record_anthropic_tool_execution(executed_calls, tc, &result),
    )
}

pub(crate) struct OpenAiToolMessage {
    pub id: String,
    pub content: String,
}

pub(crate) fn execute_openai_tools_with<F>(
    parsed_calls: &[ParsedOpenAiToolCall],
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut dispatch: F,
) -> Vec<OpenAiToolMessage>
where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    execute_tools_with(
        parsed_calls,
        seen_hashes,
        |tc, seen| dispatch(&tc.name, &tc.input, seen),
        |tc, result| {
            record_openai_tool_execution(executed_calls, tc, &result);
            OpenAiToolMessage {
                id: tc.id.clone(),
                content: result,
            }
        },
    )
}

pub(crate) fn append_openai_tool_messages(
    wire_msgs: &mut Vec<serde_json::Value>,
    tool_messages: Vec<OpenAiToolMessage>,
) {
    for tm in tool_messages {
        append_openai_tool_message(wire_msgs, &tm.id, tm.content);
    }
}

pub(crate) fn advance_tool_phase_with<TC, TR, FA, FE, FR>(
    wire_msgs: &mut Vec<serde_json::Value>,
    tool_calls: &[TC],
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut append_assistant: FA,
    mut execute_tools: FE,
    mut append_results: FR,
) where
    FA: FnMut(&mut Vec<serde_json::Value>),
    FE: FnMut(&[TC], &mut Vec<serde_json::Value>, &mut std::collections::HashSet<u64>) -> TR,
    FR: FnMut(&mut Vec<serde_json::Value>, TR),
{
    append_assistant(wire_msgs);
    let results = execute_tools(tool_calls, executed_calls, seen_hashes);
    append_results(wire_msgs, results);
}

pub(crate) fn advance_anthropic_tool_phase_from_phase_with<F>(
    wire_msgs: &mut Vec<serde_json::Value>,
    phase: &AnthropicIterationPhase,
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    dispatch: F,
) where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    advance_anthropic_tool_phase_with(
        wire_msgs,
        &phase.content_arr,
        &phase.tool_uses,
        executed_calls,
        seen_hashes,
        dispatch,
    );
}

pub(crate) fn advance_openai_tool_phase_from_phase_with<F>(
    wire_msgs: &mut Vec<serde_json::Value>,
    phase: &OpenAiIterationPhase,
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    dispatch: F,
) where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    advance_openai_tool_phase_with(
        wire_msgs,
        &phase.msg["content"],
        &phase.tool_calls_json,
        &phase.parsed_calls,
        executed_calls,
        seen_hashes,
        dispatch,
    );
}

pub(crate) fn advance_anthropic_tool_phase_with<F>(
    wire_msgs: &mut Vec<serde_json::Value>,
    content_arr: &[serde_json::Value],
    tool_uses: &[ParsedAnthropicToolUse],
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut dispatch: F,
) where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    let dispatch_ref = &mut dispatch;
    advance_tool_phase_with(
        wire_msgs,
        tool_uses,
        executed_calls,
        seen_hashes,
        |wire_msgs| append_anthropic_assistant_message(wire_msgs, content_arr),
        |tool_uses, executed_calls, seen_hashes| {
            execute_anthropic_tools_with(
                tool_uses,
                executed_calls,
                seen_hashes,
                |name, input, seen_hashes| dispatch_ref(name, input, seen_hashes),
            )
        },
        append_anthropic_tool_results_message,
    );
}

pub(crate) fn advance_openai_tool_phase_with<F>(
    wire_msgs: &mut Vec<serde_json::Value>,
    content: &serde_json::Value,
    tool_calls_json: &[serde_json::Value],
    parsed_calls: &[ParsedOpenAiToolCall],
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut dispatch: F,
) where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    let dispatch_ref = &mut dispatch;
    advance_tool_phase_with(
        wire_msgs,
        parsed_calls,
        executed_calls,
        seen_hashes,
        |wire_msgs| append_openai_assistant_message(wire_msgs, content, tool_calls_json),
        |parsed_calls, executed_calls, seen_hashes| {
            execute_openai_tools_with(
                parsed_calls,
                executed_calls,
                seen_hashes,
                |name, input, seen_hashes| dispatch_ref(name, input, seen_hashes),
            )
        },
        append_openai_tool_messages,
    );
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

pub(crate) fn push_executed_call(
    executed_calls: &mut Vec<serde_json::Value>,
    name: &str,
    input: serde_json::Value,
    result: &str,
) {
    executed_calls.push(serde_json::json!({
        "name": name,
        "input": input,
        "result": result,
    }));
}

pub(crate) fn append_anthropic_assistant_message(
    wire_msgs: &mut Vec<serde_json::Value>,
    content_arr: &[serde_json::Value],
) {
    wire_msgs.push(serde_json::json!({
        "role": "assistant",
        "content": content_arr,
    }));
}

pub(crate) fn append_anthropic_tool_results_message(
    wire_msgs: &mut Vec<serde_json::Value>,
    tool_results: Vec<serde_json::Value>,
) {
    wire_msgs.push(serde_json::json!({
        "role": "user",
        "content": tool_results,
    }));
}

pub(crate) fn append_openai_assistant_message(
    wire_msgs: &mut Vec<serde_json::Value>,
    content: &serde_json::Value,
    tool_calls_json: &[serde_json::Value],
) {
    wire_msgs.push(serde_json::json!({
        "role": "assistant",
        "content": content,
        "tool_calls": tool_calls_json,
    }));
}

pub(crate) fn append_openai_tool_message(
    wire_msgs: &mut Vec<serde_json::Value>,
    tool_call_id: &str,
    content: String,
) {
    wire_msgs.push(serde_json::json!({
        "role": "tool",
        "tool_call_id": tool_call_id,
        "content": content,
    }));
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
