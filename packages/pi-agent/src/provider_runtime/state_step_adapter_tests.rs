use super::{
    provider_iteration_contract, step_from_state_with_dispatch_contract, ProviderLoopState,
};

pub(crate) fn step_from_state_with_dispatch<P, D, FS>(
    state: &mut ProviderLoopState,
    phase: &P,
    iter_idx: u32,
    max_iter: u32,
    response: &serde_json::Value,
    dispatch: &mut D,
    mut step_fn: FS,
) -> Result<Option<String>, String>
where
    FS: FnMut(
        &mut ProviderLoopState,
        &P,
        u32,
        u32,
        &serde_json::Value,
        &mut D,
    ) -> Result<Option<String>, String>,
{
    step_from_state_with_dispatch_contract(
        state,
        provider_iteration_contract(phase, iter_idx, max_iter, response),
        dispatch,
        |state, contract, dispatch| {
            step_fn(
                state,
                contract.phase,
                contract.iter_idx,
                contract.max_iter,
                contract.response,
                dispatch,
            )
        },
    )
}
