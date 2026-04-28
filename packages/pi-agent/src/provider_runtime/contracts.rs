use super::ProviderLoopState;

pub(crate) struct ProviderIterationContract<'a, P> {
    pub phase: &'a P,
    pub iter_idx: u32,
    pub max_iter: u32,
    pub response: &'a serde_json::Value,
}

pub(crate) fn provider_iteration_contract<'a, P>(
    phase: &'a P,
    iter_idx: u32,
    max_iter: u32,
    response: &'a serde_json::Value,
) -> ProviderIterationContract<'a, P> {
    ProviderIterationContract {
        phase,
        iter_idx,
        max_iter,
        response,
    }
}

pub(crate) fn step_from_state_with_dispatch_contract<P, D, FS>(
    state: &mut ProviderLoopState,
    contract: ProviderIterationContract<'_, P>,
    dispatch: &mut D,
    mut step_fn: FS,
) -> Result<Option<String>, String>
where
    FS: FnMut(
        &mut ProviderLoopState,
        ProviderIterationContract<'_, P>,
        &mut D,
    ) -> Result<Option<String>, String>,
{
    step_fn(state, contract, dispatch)
}
