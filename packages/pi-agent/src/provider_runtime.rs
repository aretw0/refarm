mod anthropic_phase;
mod anthropic_step_phase;
mod anthropic_text;
mod anthropic_tool_phase;
mod anthropic_tool_uses;
mod contract_loop;
#[cfg(test)]
mod contract_loop_context_tests;
#[cfg(test)]
mod contract_loop_nondispatch_tests;
mod contracts;
mod loop_config;
#[cfg(test)]
mod loop_config_tests;
mod loop_core;
mod loop_dispatch;
#[cfg(test)]
mod loop_dispatch_tests;
#[cfg(any(test, target_arch = "wasm32"))]
mod loop_plan_builders;
#[cfg(any(test, target_arch = "wasm32"))]
mod loop_runner_anthropic;
#[cfg(any(test, target_arch = "wasm32"))]
mod loop_runner_common;
#[cfg(any(test, target_arch = "wasm32"))]
mod loop_runner_openai;
mod openai_tool_phase;
mod output_dedup;
#[cfg(target_arch = "wasm32")]
mod output_dedup_wasm;
mod phase_common;
mod openai_message;
mod openai_phase;
mod openai_step_phase;
mod openai_tool_calls;
mod request_anthropic_wasm;
mod request_body_anthropic;
mod request_body_openai;
mod request_flow;
mod request_headers_anthropic;
mod request_headers_common;
mod request_headers_openai;
mod request_http_wasm;
mod request_openai_wasm;
mod request_parse;
mod request_path;
#[cfg(test)]
mod state_loop_context_tests;
#[cfg(test)]
mod state_loop_dispatch_tests;
#[cfg(test)]
mod state_response_adapter_tests;
#[cfg(test)]
mod state_step_adapter_tests;
mod state_primitives;
mod step_common;
mod tool_execution;
mod tool_phase_common;
mod tool_recording;
mod tool_wire;
mod usage_extract;
mod usage_finalize;
mod usage_phase;
#[cfg(test)]
mod usage_phase_tests;
mod usage_totals;
mod wasm_anthropic;
mod wasm_loop;
mod wasm_openai;
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
pub(crate) use output_dedup_wasm::dispatch_tool_dedup;

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) use loop_runner_anthropic::anthropic_runner_config;
#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) use loop_runner_openai::openai_runner_config;

#[cfg(target_arch = "wasm32")]
pub(crate) use loop_config::{AnthropicRunnerConfig, OpenAiRunnerConfig};

#[cfg(test)]
pub(crate) use loop_config::provider_loop_state;
#[cfg(test)]
pub(crate) use loop_config_tests::provider_loop_plan_with_max_iter;
#[cfg(test)]
pub(crate) use loop_plan_builders::{
    anthropic_loop_plan, anthropic_loop_state, openai_loop_plan, openai_loop_state,
};
#[cfg(test)]
pub(crate) use loop_runner_common::provider_runner_common_config;
pub(crate) use anthropic_phase::{
    anthropic_completion_text_if_terminate, anthropic_iteration_phase, AnthropicIterationPhase,
};
pub(crate) use anthropic_tool_uses::ParsedAnthropicToolUse;
pub(crate) use openai_phase::{
    openai_completion_text_if_terminate, openai_iteration_phase, OpenAiIterationPhase,
};
pub(crate) use openai_tool_calls::ParsedOpenAiToolCall;
#[cfg(test)]
pub(crate) use step_common::step_text_or_advance_with;
#[cfg(test)]
pub(crate) use anthropic_step_phase::anthropic_step_text_or_advance_with;
#[cfg(test)]
pub(crate) use openai_step_phase::openai_step_text_or_advance_with;
pub(crate) use anthropic_tool_phase::advance_anthropic_tool_phase_from_phase_with;
pub(crate) use openai_tool_phase::advance_openai_tool_phase_from_phase_with;

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) use anthropic_step_phase::anthropic_step_from_phase_with_dispatch;
#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) use openai_step_phase::openai_step_from_phase_with_dispatch;

#[cfg(test)]
pub(crate) use phase_common::{
    completion_text_if_terminate, error_message, parse_json_arguments, should_terminate_tool_loop,
};
#[cfg(test)]
pub(crate) use anthropic_phase::anthropic_has_tool_calls;
#[cfg(test)]
pub(crate) use anthropic_tool_uses::{anthropic_content_array, parse_anthropic_tool_uses};
#[cfg(test)]
pub(crate) use anthropic_text::{anthropic_text_content, require_anthropic_text_content};
#[cfg(test)]
pub(crate) use openai_message::{
    openai_choice_message, openai_message_content, require_openai_message_content,
};
#[cfg(test)]
pub(crate) use openai_phase::openai_has_tool_calls;
#[cfg(test)]
pub(crate) use openai_tool_calls::{openai_tool_calls_array, parse_openai_tool_calls};

pub(crate) use request_headers_anthropic::anthropic_headers;
pub(crate) use request_headers_openai::openai_compat_headers;
#[cfg(test)]
pub(crate) use anthropic_tool_phase::advance_anthropic_tool_phase_with;
#[cfg(test)]
pub(crate) use openai_tool_phase::advance_openai_tool_phase_with;
#[cfg(test)]
pub(crate) use tool_phase_common::advance_tool_phase_with;
#[cfg(test)]
pub(crate) use tool_execution::{
    execute_anthropic_tools_with, execute_openai_tools_with, execute_tools_with,
};
#[cfg(test)]
pub(crate) use tool_recording::{
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
pub(crate) use request_body_anthropic::build_anthropic_body;
#[cfg(test)]
pub(crate) use request_body_openai::build_openai_body;
#[cfg(test)]
pub(crate) use request_parse::parse_response_json;
#[cfg(test)]
pub(crate) use request_path::openai_compat_path;
#[cfg(test)]
pub(crate) use request_flow::iteration_response_and_phase_with;

#[cfg(target_arch = "wasm32")]
pub(crate) use request_anthropic_wasm::anthropic_iteration_response_and_phase;
#[cfg(target_arch = "wasm32")]
pub(crate) use request_openai_wasm::openai_iteration_response_and_phase;

#[cfg(test)]
pub(crate) use loop_dispatch_tests::{
    run_completion_loop_from_common_config_with_dispatch,
    run_completion_loop_from_plan_with_dispatch,
};
pub(crate) use state_primitives::run_completion_loop_from_common_config_and_context_with_state_primitives_and_dispatch;
pub(crate) use usage_totals::UsageTotals;
pub(crate) use usage_phase::{anthropic_phase_after_usage, openai_phase_after_usage};
pub(crate) use usage_extract::response_usage;

#[cfg(test)]
pub(crate) use usage_extract::ingest_usage_from_response_with;
#[cfg(test)]
pub(crate) use usage_phase::phase_after_usage_with;
#[cfg(test)]
pub(crate) use usage_phase_tests::{
    ingest_anthropic_usage_from_response, ingest_openai_usage_from_response,
};

#[cfg(test)]
pub(crate) use contract_loop::run_completion_loop_from_common_config_with_contract_primitives_and_dispatch;
#[cfg(test)]
pub(crate) use contract_loop_context_tests::run_completion_loop_from_common_config_and_context_with_contract_primitives;
#[cfg(test)]
pub(crate) use contract_loop_nondispatch_tests::run_completion_loop_from_common_config_with_contract_primitives;
#[cfg(target_arch = "wasm32")]
pub(crate) use wasm_anthropic::run_anthropic_completion_loop;
#[cfg(target_arch = "wasm32")]
pub(crate) use wasm_openai::run_openai_completion_loop;

#[cfg(test)]
pub(crate) use state_response_adapter_tests::response_and_phase_from_state_with;
#[cfg(test)]
pub(crate) use state_step_adapter_tests::step_from_state_with_dispatch;
#[cfg(test)]
pub(crate) use state_loop_context_tests::run_completion_loop_from_common_config_and_context_with_state_primitives;
#[cfg(test)]
pub(crate) use state_loop_dispatch_tests::run_completion_loop_from_common_config_with_state_primitives_and_dispatch;

#[cfg(test)]
pub(crate) use contracts::provider_response_phase_contract;
