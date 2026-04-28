use super::{ProviderIterationContract, ProviderLoopState};

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
