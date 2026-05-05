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
mod iteration_contract;
mod iteration_step_dispatch;
mod loop_config;
#[cfg(test)]
mod loop_config_tests;
mod loop_core;
mod loop_dispatch;
#[cfg(test)]
mod loop_dispatch_tests;
mod loop_limits;
#[cfg(any(test, target_arch = "wasm32"))]
mod loop_plan_builders;
#[cfg(any(test, target_arch = "wasm32"))]
mod loop_runner_anthropic;
#[cfg(any(test, target_arch = "wasm32"))]
mod loop_runner_common;
#[cfg(any(test, target_arch = "wasm32"))]
mod loop_runner_openai;
mod loop_runner_types;
mod loop_state;
mod openai_message;
mod openai_phase;
mod openai_step_phase;
mod openai_tool_calls;
mod openai_tool_phase;
mod output_dedup;
#[cfg(target_arch = "wasm32")]
mod output_dedup_wasm;
mod phase_common;
mod request_anthropic_response_wasm;
mod request_anthropic_wasm;
mod request_body_anthropic;
mod request_body_openai;
mod request_headers_anthropic;
mod request_headers_common;
mod request_headers_openai;
mod request_http_wasm;
mod request_iteration;
mod request_openai_response_wasm;
mod request_openai_wasm;
mod request_parse;
mod request_path;
mod response_phase_contract;
#[cfg(test)]
mod state_loop_context_tests;
#[cfg(test)]
mod state_loop_dispatch_tests;
mod state_primitives;
#[cfg(test)]
mod state_response_adapter_tests;
#[cfg(test)]
mod state_step_adapter_tests;
mod step_common;
mod stream_events;
mod tool_execution;
mod tool_phase_common;
mod tool_recording;
mod tool_wire;
mod usage_extract;
mod usage_finalize;
mod usage_phase;
mod usage_phase_common;
#[cfg(test)]
mod usage_phase_tests;
mod usage_totals;
mod wasm_anthropic;
mod wasm_loop;
mod wasm_openai;
mod wire_bootstrap;

pub(crate) use iteration_contract::{provider_iteration_contract, ProviderIterationContract};
pub(crate) use iteration_step_dispatch::step_from_state_with_dispatch_contract;
pub(crate) use response_phase_contract::{
    provider_response_phase_contract_into_parts, response_phase_contract_from_state_with,
    ProviderResponsePhaseContract,
};

pub(crate) use contract_loop::run_completion_loop_from_common_config_and_context_with_contract_primitives_and_dispatch;
pub(crate) use loop_config::{ProviderLoopPlan, ProviderLoopState};
pub(crate) use loop_runner_types::ProviderRunnerCommonConfig;

pub(crate) use loop_core::{run_completion_loop_from_plan_with, CompletionLoopOutcome};
#[cfg(test)]
pub(crate) use loop_limits::tool_loop_max_iter;

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
pub(crate) use loop_runner_types::{AnthropicRunnerConfig, OpenAiRunnerConfig};

pub(crate) use anthropic_phase::{
    anthropic_completion_text_if_terminate, anthropic_iteration_phase, AnthropicIterationPhase,
};
#[cfg(test)]
pub(crate) use anthropic_step_phase::anthropic_step_text_or_advance_with;
pub(crate) use anthropic_tool_phase::advance_anthropic_tool_phase_from_phase_with;
pub(crate) use anthropic_tool_uses::ParsedAnthropicToolUse;
#[cfg(test)]
pub(crate) use loop_config_tests::provider_loop_plan_with_max_iter;
#[cfg(test)]
pub(crate) use loop_plan_builders::{
    anthropic_loop_plan, anthropic_loop_state, openai_loop_plan, openai_loop_state,
};
#[cfg(test)]
pub(crate) use loop_runner_common::provider_runner_common_config;
#[cfg(test)]
pub(crate) use loop_state::provider_loop_state;
pub(crate) use openai_phase::{
    openai_completion_text_if_terminate, openai_iteration_phase, OpenAiIterationPhase,
};
#[cfg(test)]
pub(crate) use openai_step_phase::openai_step_text_or_advance_with;
pub(crate) use openai_tool_calls::ParsedOpenAiToolCall;
pub(crate) use openai_tool_phase::advance_openai_tool_phase_from_phase_with;
#[cfg(test)]
pub(crate) use step_common::step_text_or_advance_with;

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) use anthropic_step_phase::anthropic_step_from_phase_with_dispatch;
#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) use openai_step_phase::openai_step_from_phase_with_dispatch;

#[cfg(test)]
pub(crate) use anthropic_phase::anthropic_has_tool_calls;
#[cfg(test)]
pub(crate) use anthropic_text::{anthropic_text_content, require_anthropic_text_content};
#[cfg(test)]
pub(crate) use anthropic_tool_uses::{anthropic_content_array, parse_anthropic_tool_uses};
#[cfg(test)]
pub(crate) use openai_message::{
    openai_choice_message, openai_message_content, require_openai_message_content,
};
#[cfg(test)]
pub(crate) use openai_phase::openai_has_tool_calls;
#[cfg(test)]
pub(crate) use openai_tool_calls::{openai_tool_calls_array, parse_openai_tool_calls};
#[cfg(test)]
pub(crate) use phase_common::{
    completion_text_if_terminate, error_message, parse_json_arguments, should_terminate_tool_loop,
};

#[cfg(test)]
pub(crate) use anthropic_tool_phase::advance_anthropic_tool_phase_with;
#[cfg(test)]
pub(crate) use openai_tool_phase::advance_openai_tool_phase_with;
pub(crate) use request_headers_anthropic::anthropic_headers;
pub(crate) use request_headers_openai::openai_compat_headers;
#[cfg(test)]
pub(crate) use tool_execution::{
    execute_anthropic_tools_with, execute_openai_tools_with, execute_tools_with,
};
#[cfg(test)]
pub(crate) use tool_phase_common::advance_tool_phase_with;
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
pub(crate) use request_body_anthropic::{
    build_anthropic_body, build_anthropic_body_with_streaming,
};
#[cfg(test)]
pub(crate) use request_body_openai::{build_openai_body, build_openai_body_with_streaming};
#[cfg(test)]
pub(crate) use request_iteration::iteration_response_and_phase_with;
#[cfg(test)]
pub(crate) use request_parse::parse_response_json;
#[cfg(test)]
pub(crate) use request_path::openai_compat_path;
#[cfg(all(target_arch = "wasm32", not(test)))]
pub(crate) use stream_events::emit_stream_response_chunk_drafts_from_sse;
#[cfg(test)]
pub(crate) use stream_events::{
    emit_stream_response_chunk_drafts_from_sse, parse_sse_data_events,
    parse_stream_response_chunk_drafts_from_sse, parse_stream_text_deltas,
    parse_stream_text_deltas_from_sse,
};

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
pub(crate) use usage_extract::response_usage;
pub(crate) use usage_phase::{anthropic_phase_after_usage, openai_phase_after_usage};
pub(crate) use usage_totals::UsageTotals;

#[cfg(test)]
pub(crate) use usage_extract::ingest_usage_from_response_with;
#[cfg(test)]
pub(crate) use usage_phase_common::phase_after_usage_with;
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
pub(crate) use state_loop_context_tests::run_completion_loop_from_common_config_and_context_with_state_primitives;
#[cfg(test)]
pub(crate) use state_loop_dispatch_tests::run_completion_loop_from_common_config_with_state_primitives_and_dispatch;
#[cfg(test)]
pub(crate) use state_response_adapter_tests::response_and_phase_from_state_with;
#[cfg(test)]
pub(crate) use state_step_adapter_tests::step_from_state_with_dispatch;

#[cfg(test)]
pub(crate) use response_phase_contract::provider_response_phase_contract;
