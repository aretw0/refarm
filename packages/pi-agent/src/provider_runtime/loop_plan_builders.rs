use super::{
    initial_anthropic_wire_messages, initial_openai_wire_messages,
    loop_config::{provider_loop_state, tool_loop_max_iter, ProviderLoopPlan, ProviderLoopState},
};

pub(crate) fn anthropic_loop_state(messages: &[(String, String)]) -> ProviderLoopState {
    provider_loop_state(initial_anthropic_wire_messages(messages))
}

pub(crate) fn anthropic_loop_plan(messages: &[(String, String)]) -> ProviderLoopPlan {
    ProviderLoopPlan {
        max_iter: tool_loop_max_iter(),
        state: anthropic_loop_state(messages),
    }
}

pub(crate) fn openai_loop_state(system: &str, messages: &[(String, String)]) -> ProviderLoopState {
    provider_loop_state(initial_openai_wire_messages(system, messages))
}

pub(crate) fn openai_loop_plan(system: &str, messages: &[(String, String)]) -> ProviderLoopPlan {
    ProviderLoopPlan {
        max_iter: tool_loop_max_iter(),
        state: openai_loop_state(system, messages),
    }
}
