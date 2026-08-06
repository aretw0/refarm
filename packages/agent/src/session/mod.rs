mod context_fold;
mod pure;

pub(crate) use pure::{
    budget_exceeded, compact_history, compact_history_detailed, history_from_nodes,
    history_from_tree, pick_latest_session_id, pick_latest_session_leaf_id,
    provider_name_from_env, resolve_budget_check, resolved_provider_name, session_entry_node,
    session_node, session_participant_from_agent_id, sum_provider_spend_usd, BudgetCheck,
    BudgetUnknownReason, CompactionResult,
};
#[allow(unused_imports)]
pub(crate) use context_fold::{
    build_session_context_fold, stable_hash_str, stable_hash_value, stable_stringify,
};
#[cfg(target_arch = "wasm32")]
pub(crate) use wasm_ops::record_context_fold;

#[cfg(target_arch = "wasm32")]
mod wasm_ops;

#[cfg(target_arch = "wasm32")]
pub(crate) use wasm_ops::{
    append_to_session, budget_exceeded_for_provider, get_or_create_session, query_history,
};
