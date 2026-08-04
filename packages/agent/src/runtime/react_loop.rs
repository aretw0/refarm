#[cfg(not(target_arch = "wasm32"))]
use super::native_stub::run_native_stub;
#[cfg(target_arch = "wasm32")]
use super::wasm_flow::{run_wasm_react_with_prompt_ref, run_wasm_react_with_prompt_ref_and_route};
use super::{
    policy::{context_limit_error, cumulative_limit_error, spend_limit_error, RunTotals},
    types::ReactResult,
};

/// The accumulator plus the run identity it currently belongs to. A "run" is
/// ONE effort/ONE dispatch (Task 5 resolves and clamps a budget per effort;
/// F6's burn-across-turns finding is about turns WITHIN one dispatch, not
/// across unrelated ones) — NOT the life of the loaded plugin instance. The
/// wasmtime `Store` this thread-local's substrate depends on (see below) does
/// live for the whole plugin instance, so without `last_prompt_ref` the totals
/// would silently span every dispatch the daemon ever serves.
#[derive(Default)]
struct RunState {
    totals: RunTotals,
    last_prompt_ref: Option<String>,
}

std::thread_local! {
    // Cumulative usage across every turn of ONE RUN (see `RunState`'s doc for
    // what bounds a run). `PluginInstanceHandle::call_on_event` (the tractor
    // host) drives one already-loaded plugin's on_event calls through the SAME
    // wasmtime `Store` — and therefore the same guest linear memory — across
    // every event it ever receives (the agent's `concurrentSafe` manifest flag
    // defaults false: one Store serially processes every turn, never a pool of
    // N). So this thread-local persists across separate calls into this
    // function, the same substrate `agent_events`'s `ACTIVE_PROMPT_REF` and
    // `streaming_sink`'s `ACTIVE_STREAM_RESPONSE_SINK` already rely on — but
    // unlike those two (which carry "the current one" and are simply
    // overwritten), this one must be explicitly RESET at a run boundary
    // (`starts_a_new_run`, below) rather than left to grow across the whole
    // plugin instance's lifetime.
    static RUN_TOTALS: std::cell::RefCell<RunState> =
        std::cell::RefCell::new(RunState { totals: RunTotals::default(), last_prompt_ref: None });
}

/// Whether the totals belong to a different run than `incoming` and must be
/// reset before this turn is folded in. `prompt_ref_from_effort` derives the
/// ref 1:1 from `effort.id` (`dispatch.rs`), so equal refs mean the same
/// effort/dispatch — the run boundary this program uses everywhere else.
///
/// `None` (no run identity — e.g. the native stub, or the sync `respond` verb
/// in `lib.rs`, which never threads a ref) is deliberately its OWN case,
/// always `true`: plain `Option` equality would make `None == None` (Rust's
/// default), so two back-to-back calls carrying no identity at all would
/// silently be treated as the same run and merge their spend — exactly the
/// unrelated-contamination bug this function exists to prevent, just between
/// two anonymous callers instead of two named ones. Refusing to correlate
/// anything with no identity degrades a `None` call to a plain per-turn check
/// (its own single-turn "run"), never grouping it with whatever ran last.
fn starts_a_new_run(last: &Option<String>, incoming: Option<&str>) -> bool {
    match incoming {
        None => true,
        Some(id) => last.as_deref() != Some(id),
    }
}

/// Returns: (content, tool_calls, tokens_in, tokens_out, cache_read_tokens, cache_creation_tokens, tokens_reasoning, model_id, usage_raw)
#[cfg_attr(target_arch = "wasm32", allow(dead_code))]
pub(crate) fn react(prompt: &str) -> ReactResult {
    react_with_prompt_ref(prompt, None)
}

pub(crate) fn react_with_prompt_ref(prompt: &str, prompt_ref: Option<&str>) -> ReactResult {
    react_with_prompt_ref_and_route(prompt, prompt_ref, None, None)
}

pub(crate) fn react_with_prompt_ref_and_route(
    prompt: &str,
    prompt_ref: Option<&str>,
    provider: Option<&str>,
    model: Option<&str>,
) -> ReactResult {
    if let Some(err) = context_limit_error(prompt) {
        return err;
    }

    let result: ReactResult = {
        #[cfg(target_arch = "wasm32")]
        {
            match (provider, model) {
                (None, None) => run_wasm_react_with_prompt_ref(prompt, prompt_ref),
                _ => run_wasm_react_with_prompt_ref_and_route(prompt, prompt_ref, provider, model),
            }
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            let _ = (prompt_ref, provider, model);
            run_native_stub(prompt)
        }
    };

    // The turn's usage is now known — fold it into the RUN's running totals
    // (not just this turn's) and check both ceilings before handing the result
    // back. Token check first (Step 5, resolution #2): tokens are exact, the
    // USD estimate is a rate-table guess that can go stale, so the more
    // reliable guard reports the stop when both would fire. The ceilings
    // themselves ride two env vars `handle_prompt` sets from the per-effort
    // payload the sidecar builds (Task 5's resolved budget) — absent env means
    // absent declaration anywhere in the fold, so an installation that
    // declares nothing reads `None` here exactly as it always has.
    let (content, tool_calls, tokens_in, tokens_out, cache_read_tokens, cache_creation_tokens, tokens_reasoning, model_id, usage_raw) =
        result;
    let token_limit = std::env::var("MODEL_RUN_MAX_TOKENS")
        .ok()
        .and_then(|v| v.parse::<u32>().ok());
    let cumulative_tokens = RUN_TOTALS.with(|run| {
        let mut run = run.borrow_mut();
        // Reset BEFORE folding, not after: the first turn of a brand new run
        // must start from zero, not land on top of the previous run's leftover
        // total. The reset decision (and the `last_prompt_ref` update) happens
        // exactly once per turn, here — the spend fold below shares the same
        // already-current-for-this-turn state.
        if starts_a_new_run(&run.last_prompt_ref, prompt_ref) {
            run.totals = RunTotals::default();
            run.last_prompt_ref = prompt_ref.map(str::to_owned);
        }
        run.totals.add_turn(tokens_in, tokens_out);
        run.totals.total()
    });
    if let Some(err) = cumulative_limit_error(cumulative_tokens, token_limit) {
        return err;
    }
    let provider_name = provider
        .map(str::to_owned)
        .unwrap_or_else(crate::provider_name_from_env);
    let turn_spend_usd = crate::estimate_billable_usd(
        &provider_name,
        &model_id,
        tokens_in,
        tokens_out,
        cache_read_tokens,
        cache_creation_tokens,
    );
    let usd_limit = std::env::var("MODEL_RUN_MAX_USD")
        .ok()
        .and_then(|v| v.parse::<f64>().ok());
    let cumulative_usd = RUN_TOTALS.with(|run| {
        let mut run = run.borrow_mut();
        // No reset check here: the token fold above already decided the run
        // boundary for THIS turn (same call, same prompt_ref) — re-checking
        // would be redundant at best and, if it somehow disagreed, a second
        // silent reset that discards the token fold just applied.
        run.totals.add_spend_usd(turn_spend_usd);
        run.totals.total_usd()
    });
    if let Some(err) = spend_limit_error(&provider_name, cumulative_usd, usd_limit) {
        return err;
    }

    (
        content,
        tool_calls,
        tokens_in,
        tokens_out,
        cache_read_tokens,
        cache_creation_tokens,
        tokens_reasoning,
        model_id,
        usage_raw,
    )
}

/// How many turns the CURRENT run (the same `RUN_TOTALS` scope `RunState`'s
/// doc describes) has completed as of the last fold — "the step the run
/// reached", F1's other missing half alongside the ceiling that already
/// travels on `BudgetObservation`. Read right after a turn's call into
/// `react_with_prompt_ref_and_route` returns (`prompt_handler.rs`), the same
/// read-the-accumulator-after-the-call pattern `streaming_sink::
/// take_active_stream_last_sequence` already uses two lines up from that call
/// site — not threaded through `ReactResult`, whose every caller already
/// destructures it by fixed position.
pub(crate) fn current_run_turns() -> u32 {
    RUN_TOTALS.with(|run| run.borrow().totals.turns())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── starts_a_new_run (pure) ───────────────────────────────────────────────

    #[test]
    fn same_prompt_ref_is_not_a_new_run() {
        assert!(!starts_a_new_run(&Some("run-a".to_string()), Some("run-a")));
    }

    #[test]
    fn a_different_prompt_ref_is_a_new_run() {
        assert!(starts_a_new_run(&Some("run-a".to_string()), Some("run-b")));
    }

    #[test]
    fn no_prior_run_is_a_new_run() {
        assert!(starts_a_new_run(&None, Some("run-a")));
    }

    #[test]
    fn an_absent_prompt_ref_is_always_its_own_new_run() {
        // Two calls that BOTH carry no run identity must never be treated as
        // the same run just because `None == None` under plain Option
        // equality — see `starts_a_new_run`'s doc for why that default would
        // silently merge two unrelated anonymous callers.
        assert!(starts_a_new_run(&None, None));
        assert!(starts_a_new_run(&Some("run-a".to_string()), None));
    }

    // ── the real call site: RUN_TOTALS must not span two different runs ──────

    #[test]
    fn a_new_prompt_ref_resets_the_running_totals_rather_than_inheriting_the_previous_runs_spend() {
        // Regression for fix round 1's Critical finding: RUN_TOTALS must be
        // scoped to ONE run (one prompt_ref), not the life of the loaded
        // plugin instance. Seed the thread-local as if a PREVIOUS run
        // ("run-a") already burned well past a ceiling that would trip a
        // fresh run's very first turn, then drive the REAL call site
        // (`react_with_prompt_ref`, not a hand-built `RunTotals`) with a
        // DIFFERENT prompt_ref ("run-b"). Before the fix this test fails:
        // run-b's first turn inherits run-a's 50_000 and
        // MODEL_RUN_MAX_TOKENS=10 blocks it immediately — observed below.
        RUN_TOTALS.with(|run| {
            let mut run = run.borrow_mut();
            run.totals.add_turn(50_000, 0);
            run.last_prompt_ref = Some("run-a".to_string());
        });
        std::env::set_var("MODEL_RUN_MAX_TOKENS", "10");
        let result = react_with_prompt_ref("hello", Some("run-b"));
        std::env::remove_var("MODEL_RUN_MAX_TOKENS");
        assert_eq!(
            result.7, "stub",
            "run-b must start clean, not inherit run-a's leftover spend and block on its first turn"
        );
        RUN_TOTALS.with(|run| {
            assert_eq!(
                run.borrow().totals.total(),
                0,
                "run-b's own turn (native stub) contributes 0 tokens — the total must be \
                 exactly that, not 50_000 + 0, once the reset has run"
            );
        });
    }

    // ── current_run_turns (F1's other missing half) ───────────────────────────

    #[test]
    fn current_run_turns_counts_within_a_run_and_resets_across_one() {
        // Distinct literals from the fixtures above so this test is correct
        // regardless of thread-local leftovers from a prior test sharing this
        // thread (the existing regression test above relies on the same
        // property — a fresh prompt_ref always trips `starts_a_new_run`).
        let _ = react_with_prompt_ref("hello", Some("turns-run-a"));
        assert_eq!(current_run_turns(), 1, "the first turn of a run is step 1");

        let _ = react_with_prompt_ref("hello again", Some("turns-run-a"));
        assert_eq!(
            current_run_turns(),
            2,
            "a second turn of the SAME run accumulates onto the first"
        );

        let _ = react_with_prompt_ref("a new run entirely", Some("turns-run-b"));
        assert_eq!(
            current_run_turns(),
            1,
            "a different prompt_ref starts a NEW run — the turn count resets to 1, \
             not 3, exactly like the token/spend totals it rides beside"
        );
    }
}
