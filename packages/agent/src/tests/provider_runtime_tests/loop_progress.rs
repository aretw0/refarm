//! *"Died at 4/25"*, driven through the real loop.
//!
//! Every test here runs `run_completion_loop_with` — the one `for` statement
//! that both bounds the run and counts it — and then reads what a `UsageRecord`
//! would carry. Nothing constructs a `LoopProgress` by hand: the defect these
//! pin was two counters that were each individually correct and did not belong
//! in the same fraction, which no hand-built fixture can catch.

use crate::provider_runtime::{
    clear_loop_progress, current_loop_progress, provider_loop_state, run_completion_loop_with,
    LoopProgress,
};

/// Drive the real loop with `max_iter`, finishing on the 1-based step
/// `finish_on_step` (or running to the ceiling when it is never reached), and
/// return the step pair a `UsageRecord` written right afterwards would carry.
fn run_loop_and_read_progress(max_iter: u32, finish_on_step: u32) -> Option<LoopProgress> {
    // Tests share a thread under `--test-threads=1`, and the progress lives in a
    // thread-local — clear first, exactly as a real dispatch does.
    clear_loop_progress();
    let _ = run_completion_loop_with(
        max_iter,
        provider_loop_state(Vec::new()),
        |_state| Ok((serde_json::json!({"ok": true}), 0_u8)),
        |_state, _phase, iter_idx, max_steps, _response| {
            // `has_tool_calls` is "the model has not finished yet", i.e. it is
            // still asking for tools up to `finish_on_step`. Termination itself
            // goes through the REAL rule, so these tests cannot pass by
            // reimplementing the boundary they exist to pin.
            let has_tool_calls = iter_idx + 1 < finish_on_step;
            if crate::provider_runtime::should_terminate_tool_loop(has_tool_calls, iter_idx, max_steps)
            {
                Ok(Some("done".to_string()))
            } else {
                Ok(None)
            }
        },
    );
    current_loop_progress()
}

#[test]
fn the_live_case_a_run_that_reached_step_two_of_twenty_five_records_two_of_twenty_five() {
    // Measured on this machine, 2026-08-05. A `refarm ask` that used one tool
    // printed `step 1/25`, `tool glob`, `step 2/25` — and its UsageRecord
    // recorded `steps_completed: 1` with no `steps_planned` at all, because the
    // numerator was the TURN count (one dispatch) and the denominator was never
    // carried. Both halves now come from this loop, so the record says what the
    // operator watched.
    let progress = run_loop_and_read_progress(25, 2).expect("the loop ran, so a pair exists");
    assert_eq!(
        progress.steps_completed, 2,
        "the operator's last line was `step 2/25`; the record must say 2, not the \
         turn count of 1 it used to carry"
    );
    assert_eq!(progress.steps_planned, 25, "and the 25 it was rendered against");
}

#[test]
fn both_halves_come_from_the_same_loop_so_they_count_the_same_notion() {
    // The rule this whole change exists to enforce: a numerator counting turns
    // beside a denominator counting steps is worse than no fraction at all.
    // A ceiling of 9 must be recorded against a numerator bounded BY 9 — not
    // against a count of dispatches, which no `MODEL_TOOL_CALL_MAX_ITER` bounds.
    let progress = run_loop_and_read_progress(9, 4).expect("the loop ran");
    assert_eq!(progress.steps_completed, 4);
    assert_eq!(progress.steps_planned, 9);
    assert!(
        progress.steps_completed <= progress.steps_planned,
        "a numerator that can exceed its denominator is proof the two count \
         different things: {progress:?}"
    );
}

#[test]
fn a_run_with_no_tool_calls_records_a_coherent_pair_not_a_lone_numerator() {
    // The model answered on its first completion and asked for nothing. That is
    // one step of a twenty-five step budget — a whole fraction, not a numerator
    // with the denominator left absent because "there was no plan".
    let progress = run_loop_and_read_progress(25, 1).expect("one step still ran the loop");
    assert_eq!(progress.steps_completed, 1);
    assert_eq!(progress.steps_planned, 25);
}

#[test]
fn a_dispatch_that_never_reached_the_loop_records_no_pair_rather_than_zero_of_twenty_five() {
    // A context-limit refusal returns before the completion loop. The honest
    // record of that run has NO step pair: `0` would claim zero steps of a
    // budget were burned, and `25` would name a ceiling nothing enforced.
    clear_loop_progress();
    assert_eq!(
        current_loop_progress(),
        None,
        "no loop, no measurement — and therefore no numerator and no denominator"
    );
}

// ── the off-by-one: a ceiling of N used to permit N+1 steps ──────────────────

#[test]
fn a_ceiling_of_twenty_five_runs_exactly_twenty_five_steps_never_twenty_six() {
    // `0..=max_iter` ran `max_iter + 1` iterations: 25 permitted 26 completions,
    // the sidecar rendered the last as `step 26/25` (a progress fraction above
    // 1.0), and the cutoff message claimed "Reached the tool-iteration limit
    // (25)" after 26. The numerator counted completions while the denominator
    // counted rounds — the same two-notions defect, one layer down.
    //
    // `finish_on_step: u32::MAX` means the model never stops asking for tools,
    // so only the ceiling can end this run.
    let progress = run_loop_and_read_progress(25, u32::MAX).expect("the loop ran");
    assert_eq!(
        progress.steps_completed, 25,
        "a run that goes the whole distance ends at 25/25, never at 26/25"
    );
    assert_eq!(progress.steps_planned, 25);
}

#[test]
fn a_plan_declaring_zero_steps_still_runs_exactly_one_and_reports_one() {
    // `max_iter.max(1)`: you cannot run zero steps, and `0..0` would fall
    // through the loop to `unreachable!`. Zero is reported as the one step it
    // actually is, in both halves — the pre-existing `0..=0` behaviour, now
    // spelled so the record can describe it.
    let progress = run_loop_and_read_progress(0, u32::MAX).expect("one step always runs");
    assert_eq!(progress.steps_completed, 1);
    assert_eq!(progress.steps_planned, 1);
}

#[test]
fn the_progress_of_one_dispatch_never_leaks_into_the_next() {
    // The pair lives in a thread-local on the same substrate `RUN_TOTALS` uses,
    // and one wasmtime `Store` serves every dispatch this daemon ever handles.
    // A long dispatch followed by a refused one must not lend the refused one
    // its step pair.
    let long_run = run_loop_and_read_progress(25, 7).expect("the loop ran");
    assert_eq!(long_run.steps_completed, 7);

    clear_loop_progress();
    assert_eq!(
        current_loop_progress(),
        None,
        "the next dispatch starts with no measurement of its own, and must not \
         inherit 7/25 from the one before it"
    );
}
