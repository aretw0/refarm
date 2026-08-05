//! The step pair behind *"died at 4/25"* — the numerator AND the denominator,
//! counted in the SAME notion by the one loop that owns both.
//!
//! A **step** is one iteration of the provider completion loop (`loop_core.rs`):
//! one model completion plus the tool round it may request. `max` is the
//! iteration ceiling that governed THAT loop (`loop_limits::tool_loop_max_iter`,
//! default 25). Both halves come from the same `for` statement, so a recorded
//! `4/25` means exactly what the operator watched the sidecar print as
//! `step 4/25` (`tractor/src/sidecar/agent_activity.rs`).
//!
//! A step is **not** a TURN. `RunTotals::turns` (`runtime/policy.rs`) counts
//! whole dispatches into the agent — one `refarm ask` is ONE turn no matter how
//! many steps it takes. That distinction is the entire bug this module exists to
//! close: `UsageRecord.steps_completed` used to carry the TURN count (always 1
//! for a single ask) beside a denominator that counted STEPS, which is a
//! fraction whose halves count different things — worse than no fraction at all.
//! The turn count still travels, under its own name (`turns_completed`), with no
//! denominator because no turn ceiling exists.
//!
//! ## Why a thread-local rather than a return value
//!
//! The loop's result type (`ReactResult`) is destructured by fixed position at
//! every call site, and the loop sits five frames below `prompt_handler`. This is
//! the same read-the-accumulator-right-after-the-call pattern
//! `react_loop::current_run_turns` and `streaming_sink::
//! take_active_stream_last_sequence` already use, on the same substrate: one
//! wasmtime `Store` serially processes one dispatch at a time.
//!
//! ## Absent, never fabricated
//!
//! `clear` runs at the top of EVERY dispatch (`react_loop.rs`). A dispatch that
//! never reaches the loop — a context-limit refusal, the native stub — therefore
//! reports `None`, and the record carries no step pair rather than a stale one
//! from the previous dispatch or a `25` copied from the default. D6.

// This crate is a WASM guest: on a plain native `--lib` build nothing drives the
// completion loop (`run_native_stub` stands in for it), so the readers below are
// reachable only from the wasm runners and from the tests that pin them — the
// same shape the rest of `provider_runtime` already has.
#![allow(dead_code)]

use std::cell::RefCell;

/// How far a dispatch's completion loop got, and how far it was allowed to get.
/// Both halves count STEPS (see the module doc); `steps_completed` is 1-based,
/// so the first iteration reports `1`, matching the `step 1/N` the sidecar
/// renders from the very same iteration's `agent:iteration` event.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct LoopProgress {
    pub steps_completed: u32,
    pub steps_planned: u32,
}

thread_local! {
    static LOOP_PROGRESS: RefCell<Option<LoopProgress>> = const { RefCell::new(None) };
}

/// Forget any previous dispatch's progress. Called at dispatch entry so that a
/// dispatch which never runs the loop reports `None` instead of inheriting.
pub(crate) fn clear_loop_progress() {
    LOOP_PROGRESS.with(|p| *p.borrow_mut() = None);
}

/// Record that the loop has entered iteration `iter_idx` (0-based) of a
/// `max_steps`-step budget. Stored 1-based so the numerator is directly
/// comparable to `max_steps` — the two halves are set together, from the same
/// call, and can never drift into different notions.
pub(crate) fn record_step(iter_idx: u32, max_steps: u32) {
    LOOP_PROGRESS.with(|p| {
        *p.borrow_mut() = Some(LoopProgress {
            steps_completed: iter_idx.saturating_add(1),
            steps_planned: max_steps,
        });
    });
}

/// The step pair of the dispatch that just ran, or `None` when no completion
/// loop ran in it.
pub(crate) fn current_loop_progress() -> Option<LoopProgress> {
    LOOP_PROGRESS.with(|p| *p.borrow())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cleared_dispatch_reports_no_pair_at_all() {
        clear_loop_progress();
        assert_eq!(
            current_loop_progress(),
            None,
            "a dispatch that never reached the loop must record NO pair — not 0/25, \
             not a stale pair from the dispatch before it"
        );
    }

    #[test]
    fn the_first_step_is_one_not_zero_so_it_matches_the_rendered_fraction() {
        clear_loop_progress();
        record_step(0, 25);
        assert_eq!(
            current_loop_progress(),
            Some(LoopProgress {
                steps_completed: 1,
                steps_planned: 25
            }),
            "iteration index 0 is the step the sidecar prints as `step 1/25`"
        );
    }

    #[test]
    fn the_pair_advances_together_and_both_halves_count_steps() {
        clear_loop_progress();
        record_step(0, 25);
        record_step(1, 25);
        let progress = current_loop_progress().expect("the loop ran");
        assert_eq!(progress.steps_completed, 2);
        assert_eq!(progress.steps_planned, 25);
    }
}
