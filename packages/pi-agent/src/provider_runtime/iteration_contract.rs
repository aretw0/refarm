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
