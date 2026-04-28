mod anthropic_phase;
mod contract_loop;
mod contracts;
mod loop_config;
mod loop_core;
mod loop_dispatch;
mod output_dedup;
mod phase_common;
mod openai_phase;
mod request_builders;
mod request_flow;
#[cfg(test)]
mod state_adapters;
#[cfg(test)]
mod state_loop_tests;
mod state_primitives;
mod step_phase;
mod tool_execution;
mod tool_phase;
mod tool_wire;
mod usage_finalize;
mod usage_phase;
mod wasm_loop;
mod wasm_runners;
mod wire_bootstrap;

pub(crate) use contracts::{
    provider_iteration_contract, provider_response_phase_contract_into_parts,
    response_phase_contract_from_state_with, step_from_state_with_dispatch_contract,
    ProviderIterationContract, ProviderResponsePhaseContract,
};

pub(crate) use contract_loop::run_completion_loop_from_common_config_and_context_with_contract_primitives_and_dispatch;
pub(crate) use loop_config::{ProviderLoopPlan, ProviderLoopState, ProviderRunnerCommonConfig};

#[cfg(test)]
pub(crate) use loop_config::tool_loop_max_iter;
pub(crate) use loop_core::{run_completion_loop_from_plan_with, CompletionLoopOutcome};

#[cfg(test)]
pub(crate) use loop_core::run_completion_loop_with;
pub(crate) use loop_dispatch::run_completion_loop_from_common_config_and_context_with_dispatch;
#[cfg(test)]
pub(crate) use output_dedup::{dedup_tool_output, dispatch_and_dedup_with};

#[cfg(target_arch = "wasm32")]
pub(crate) use output_dedup::dispatch_tool_dedup;

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) use loop_config::{anthropic_runner_config, openai_runner_config};

#[cfg(target_arch = "wasm32")]
pub(crate) use loop_config::{AnthropicRunnerConfig, OpenAiRunnerConfig};

#[cfg(test)]
pub(crate) use loop_config::{
    anthropic_loop_plan, anthropic_loop_state, openai_loop_plan, openai_loop_state,
    provider_loop_plan_with_max_iter, provider_loop_state, provider_runner_common_config,
};
pub(crate) use anthropic_phase::{
    anthropic_completion_text_if_terminate, anthropic_iteration_phase, AnthropicIterationPhase,
    ParsedAnthropicToolUse,
};
pub(crate) use openai_phase::{
    openai_completion_text_if_terminate, openai_iteration_phase, OpenAiIterationPhase,
    ParsedOpenAiToolCall,
};
#[cfg(test)]
pub(crate) use step_phase::{
    anthropic_step_text_or_advance_with, openai_step_text_or_advance_with,
    step_text_or_advance_with,
};
pub(crate) use tool_phase::{
    advance_anthropic_tool_phase_from_phase_with, advance_openai_tool_phase_from_phase_with,
};

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) use step_phase::{
    anthropic_step_from_phase_with_dispatch, openai_step_from_phase_with_dispatch,
};

#[cfg(test)]
pub(crate) use phase_common::{
    completion_text_if_terminate, error_message, parse_json_arguments, should_terminate_tool_loop,
};
#[cfg(test)]
pub(crate) use anthropic_phase::{
    anthropic_content_array, anthropic_has_tool_calls, anthropic_text_content,
    parse_anthropic_tool_uses, require_anthropic_text_content,
};
#[cfg(test)]
pub(crate) use openai_phase::{
    openai_choice_message, openai_has_tool_calls, openai_message_content, openai_tool_calls_array,
    parse_openai_tool_calls, require_openai_message_content,
};

pub(crate) use request_builders::{anthropic_headers, openai_compat_headers};
#[cfg(test)]
pub(crate) use tool_phase::{
    advance_anthropic_tool_phase_with, advance_openai_tool_phase_with, advance_tool_phase_with,
};
#[cfg(test)]
pub(crate) use tool_execution::{
    execute_anthropic_tools_with, execute_openai_tools_with, execute_tools_with,
    push_executed_call, record_anthropic_tool_execution, record_openai_tool_execution,
};
#[cfg(test)]
pub(crate) use tool_wire::{
    anthropic_tool_result, append_anthropic_assistant_message,
    append_anthropic_tool_results_message, append_openai_assistant_message,
    append_openai_tool_message, append_openai_tool_messages, OpenAiToolMessage,
};
pub(crate) use wire_bootstrap::{initial_anthropic_wire_messages, initial_openai_wire_messages};

#[cfg(test)]
pub(crate) use request_builders::{
    build_anthropic_body, build_openai_body, openai_compat_path, parse_response_json,
};
#[cfg(test)]
pub(crate) use request_flow::iteration_response_and_phase_with;

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
pub(crate) use usage_phase::{
    anthropic_phase_after_usage, openai_phase_after_usage, response_usage,
};

#[cfg(test)]
pub(crate) use usage_phase::{
    ingest_anthropic_usage_from_response, ingest_openai_usage_from_response,
    ingest_usage_from_response_with, phase_after_usage_with,
};

#[cfg(test)]
pub(crate) use contract_loop::{
    run_completion_loop_from_common_config_and_context_with_contract_primitives,
    run_completion_loop_from_common_config_with_contract_primitives,
    run_completion_loop_from_common_config_with_contract_primitives_and_dispatch,
};
#[cfg(target_arch = "wasm32")]
pub(crate) use wasm_runners::{run_anthropic_completion_loop, run_openai_completion_loop};

#[cfg(test)]
pub(crate) use state_adapters::{
    response_and_phase_from_state_with, step_from_state_with_dispatch,
};
#[cfg(test)]
pub(crate) use state_loop_tests::{
    run_completion_loop_from_common_config_and_context_with_state_primitives,
    run_completion_loop_from_common_config_with_state_primitives_and_dispatch,
};

#[cfg(test)]
pub(crate) use contracts::provider_response_phase_contract;
