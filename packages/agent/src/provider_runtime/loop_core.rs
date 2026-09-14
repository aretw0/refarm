use super::{ProviderLoopPlan, ProviderLoopState};

pub(crate) fn run_completion_loop_with<P, FR, FS>(
    max_iter: u32,
    mut state: ProviderLoopState,
    mut response_and_phase: FR,
    mut step: FS,
) -> Result<CompletionLoopOutcome, String>
where
    FR: FnMut(&mut ProviderLoopState) -> Result<(serde_json::Value, P), String>,
    FS: FnMut(
        &mut ProviderLoopState,
        &P,
        u32,
        u32,
        &serde_json::Value,
    ) -> Result<Option<String>, String>,
{
    // `max_iter` is a COUNT of steps, not a maximum index. It used to be read as
    // an index (`0..=max_iter`), which ran `max_iter + 1` iterations: a ceiling of
    // 25 permitted 26 completions, the sidecar rendered the last one as
    // `step 26/25` (a progress fraction above 1.0), and the cutoff message claimed
    // "Reached the tool-iteration limit (25)" after 26. Numerator counted
    // completions, denominator counted rounds — two notions in one fraction, the
    // exact defect `loop_progress.rs` exists to prevent. Clamped to at least one
    // step so a plan declaring 0 still runs — and terminates on — a single
    // iteration, exactly as `0..=0` did, and never falls through to `unreachable!`.
    let max_steps = max_iter.max(1);
    for iter_idx in 0..max_steps {
        // The step pair the record will carry, set from the same statement that
        // bounds the loop so both halves can only ever count steps.
        super::loop_progress::record_step(iter_idx, max_steps);
        // AgentEvent: the run entered react iteration `iter_idx` of `max_steps` — lets
        // an observer spot a looping/runaway agent (correlated via ambient run ctx).
        crate::agent_events::iteration(iter_idx, max_steps);
        let (response, phase) = response_and_phase(&mut state)?;
        if let Some(text) = step(&mut state, &phase, iter_idx, max_steps, &response)? {
            return Ok(CompletionLoopOutcome {
                state,
                response,
                text,
            });
        }
    }
    unreachable!()
}

pub(crate) fn run_completion_loop_from_plan_with<P, FR, FS>(
    plan: ProviderLoopPlan,
    response_and_phase: FR,
    step: FS,
) -> Result<CompletionLoopOutcome, String>
where
    FR: FnMut(&mut ProviderLoopState) -> Result<(serde_json::Value, P), String>,
    FS: FnMut(
        &mut ProviderLoopState,
        &P,
        u32,
        u32,
        &serde_json::Value,
    ) -> Result<Option<String>, String>,
{
    run_completion_loop_with(plan.max_iter, plan.state, response_and_phase, step)
}

pub(crate) struct CompletionLoopOutcome {
    pub state: ProviderLoopState,
    pub response: serde_json::Value,
    pub text: String,
}
