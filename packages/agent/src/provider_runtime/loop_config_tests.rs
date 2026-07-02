use super::{provider_loop_state, ProviderLoopPlan};

pub(crate) fn provider_loop_plan_with_max_iter(
    initial_wire_msgs: Vec<serde_json::Value>,
    max_iter: u32,
) -> ProviderLoopPlan {
    ProviderLoopPlan {
        max_iter,
        state: provider_loop_state(initial_wire_msgs),
    }
}
