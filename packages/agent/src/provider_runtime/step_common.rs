use super::ProviderLoopState;

pub(crate) fn step_text_or_advance_with<P, FC, FA>(
    state: &mut ProviderLoopState,
    phase: &P,
    iter_idx: u32,
    max_iter: u32,
    response: &serde_json::Value,
    mut completion_text_if_terminate_fn: FC,
    mut advance_phase_fn: FA,
) -> Result<Option<String>, String>
where
    FC: FnMut(&P, u32, u32, &serde_json::Value) -> Result<Option<String>, String>,
    FA: FnMut(&mut ProviderLoopState, &P),
{
    if let Some(text) = completion_text_if_terminate_fn(phase, iter_idx, max_iter, response)? {
        return Ok(Some(text));
    }

    advance_phase_fn(state, phase);
    Ok(None)
}
