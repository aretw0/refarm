//! `refarm.verification.*` — WHETHER THE RUN WAS RIGHT, which is a different
//! question from `refarm.outcome` and must never be read off it.
//!
//! **What forced this, measured on 2026-08-05.** The operator asked the agent to
//! count the `.md` files in a directory. It answered 58. The answer is 59. The
//! `BudgetObservation` for that run recorded `refarm.outcome: "done"` — and that
//! was CORRECT: `outcome` is the effort's terminal status and `done` means the
//! run COMPLETED. The defect was that nothing else existed, so every reader
//! inferred correctness from completion, and a bench built on this record would
//! have ranked models by cost and speed while blind to which one was right.
//!
//! **`refarm.outcome` does not change meaning here and is never overwritten.** A
//! run that completed and answered wrongly is `outcome: "done"` with
//! `refarm.verification.passed: false` — two facts, two keys. Folding the
//! failed verification into the status would destroy the very distinction this
//! module exists to create, and would also lie about the machine: nothing
//! failed, nothing timed out, the effort ran to completion.
//!
//! **Three states, never two.**
//!
//! - `refarm.verification.passed` **absent** — nobody checked. This is the
//!   ordinary case and the default: an effort that declared no expectation
//!   carries no verification key at all, exactly as an undeclared scenario
//!   carries no `refarm.scenario.id` (D6, and see `sidecar::scenario`).
//! - `passed: true` — a comparison RAN and matched.
//! - `passed: false` — a comparison RAN and did not match.
//!
//! An expectation that was declared but could not be COMPARED is none of those
//! three: it leaves `passed` absent and records why in `refarm.verification.unknown`
//! ([`Unverifiable`]). Recording `false` there would accuse a model of being
//! wrong when nobody looked — the same mistake `contextWindowUnknown` exists to
//! prevent in `packages/model-catalog-v1/src/index.ts`, where recording
//! `not-published` for what was really `source-not-found` stated something about
//! a third party that was never verified.
//!
//! **The method rides beside the verdict** ([`METHOD_SUBSTRING`]) so that a row
//! written today stays interpretable the day a second matcher exists. A bare
//! `true` whose meaning depends on which version of this file wrote it is not
//! evidence; it is a number that changes shape behind the reader's back.
//!
//! **What this cannot do, stated rather than discovered.** A substring match
//! only grades work whose answer is checkable that way — a count, an id, a
//! literal the answer must contain. It cannot grade a summary, a refactor, a
//! judgement call, or a numerically-close-but-not-identical answer (`58.999` is
//! not `59` here, and `159` DOES contain `59`). Those runs are not "unverified
//! because something broke"; they are work this instrument does not measure, and
//! declaring an expectation on them produces a verdict that means less than it
//! looks like it means.
//!
//! **What is deliberately NOT built, so it does not read as forgotten**: regex,
//! numeric tolerance, and an external checker command. Each is a real matcher
//! someone will want, and each needs a consumer to fix its semantics (what
//! flavour of regex, what tolerance on what unit, what trust boundary a checker
//! command runs inside). No consumer needs any of them today. `method` is the
//! seam they arrive through when one does — a new constant beside
//! [`METHOD_SUBSTRING`], with old rows still saying which rule judged them.

use super::TaskResult;

/// The one matcher this record ships with, stamped on every verdict as
/// `refarm.verification.method`.
///
/// **The rule, in full:** the declared expectation, TRIMMED, must appear as a
/// SUBSTRING of the run's answer text, TRIMMED. Case-sensitive. No whitespace
/// collapsing, no unicode normalisation, no regex, no numeric tolerance, no
/// external checker. A verdict of `true` under this method asserts exactly
/// that and nothing more.
pub(crate) const METHOD_SUBSTRING: &str = "substring";

/// Why a DECLARED expectation produced no verdict at all.
///
/// The two variants split the same way `ModelContextWindowUnknown`'s do, and for
/// the same reason — one is a fact about the subject, the other is a gap in OUR
/// checking, and collapsing them closes a question nobody has actually answered:
///
/// - [`Unverifiable::NoResult`] — the run left nothing to read. That is a fact
///   about the run (a `failed`/`cancelled`/`timed-out` effort carries an error,
///   not an answer), and no better matcher would change it.
/// - [`Unverifiable::ResultNotReadable`] — a result payload exists, but this
///   matcher cannot find an answer inside its shape. That is a gap in this
///   file, not a fact about the run, and it is someone's next task.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Unverifiable {
    NoResult,
    ResultNotReadable,
}

impl Unverifiable {
    /// The wire value written to `refarm.verification.unknown`. Kebab-case, to
    /// match `ModelContextWindowUnknown.reason`'s vocabulary rather than invent
    /// a second spelling convention for the same kind of field.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Unverifiable::NoResult => "no-result",
            Unverifiable::ResultNotReadable => "result-not-readable",
        }
    }
}

/// The three states, as a type — so "declared but not comparable" cannot be
/// spelled `false` by a later edit. There is no `Verification::Absent`: the
/// fourth state ("nobody checked") is the ABSENCE of this value entirely
/// (`ObservationInput.verification == None`), which is what keeps it the
/// zero-cost default for the whole of ordinary field use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Verification {
    Matched,
    NotMatched,
    Unverifiable(Unverifiable),
}

impl Verification {
    /// The verdict for `refarm.verification.passed` — `None` when a comparison
    /// could not run, which is the ONLY way that key is ever omitted on a run
    /// that declared an expectation.
    pub(crate) fn passed(self) -> Option<bool> {
        match self {
            Verification::Matched => Some(true),
            Verification::NotMatched => Some(false),
            Verification::Unverifiable(_) => None,
        }
    }

    /// The matcher that produced the verdict, for `refarm.verification.method`.
    /// Present exactly when [`Verification::passed`] is: a method with no
    /// verdict beside it would claim a comparison that never happened.
    pub(crate) fn method(self) -> Option<&'static str> {
        match self {
            Verification::Matched | Verification::NotMatched => Some(METHOD_SUBSTRING),
            Verification::Unverifiable(_) => None,
        }
    }

    /// Why there is no verdict, for `refarm.verification.unknown`. Present
    /// exactly when [`Verification::passed`] is absent — the two are
    /// complementary by construction, never both and never neither.
    pub(crate) fn unknown(self) -> Option<&'static str> {
        match self {
            Verification::Matched | Verification::NotMatched => None,
            Verification::Unverifiable(reason) => Some(reason.as_str()),
        }
    }
}

/// What the caller declared and what comparing it produced, riding TOGETHER —
/// the same rule `DispatchedScenario` follows for its two halves, and for the
/// same reason: a verdict with no expectation beside it cannot be re-read by a
/// human ("false against WHAT?"), and an expectation with no verdict slot at all
/// would have nowhere to say it was unverifiable.
pub(crate) struct DeclaredVerification<'a> {
    /// The caller's declaration, already normalised by [`declared_expectation`].
    pub(crate) expected: &'a str,
    pub(crate) verdict: Verification,
}

/// Normalise a declared expectation: trimmed, and an empty declaration read as
/// no declaration at all.
///
/// Empty is not an expectation, and here that is not merely tidiness: `""` is a
/// substring of every string, so an empty declaration would record
/// `passed: true` on every run that produced any answer whatsoever — a verdict
/// that says nothing while looking exactly like one that says something. Same
/// rule, same reason as `scenario::declared_scenario_id`.
pub(crate) fn declared_expectation(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// The run's ANSWER, or why there isn't one to read.
///
/// Two shapes are read, because two are what the finaliser actually writes: the
/// respond path finalises `TaskResult.result = {"content": "…", …usage}` (see
/// `dispatch`'s terminal-result watcher), and a bare JSON string is the same
/// answer spelled without the envelope. The first readable one wins — today an
/// effort finalises with a single `TaskResult`, and scanning rather than
/// indexing `[0]` costs nothing and survives the day it does not.
///
/// Anything else is [`Unverifiable::ResultNotReadable`], NOT a failed match: an
/// event dispatch's `{"dispatched": …, "sent": …}` receipt is a real result that
/// simply is not an answer, and stringifying the whole payload to substring-match
/// against it would let an expectation "match" a plugin id or an event name.
fn answer_text(results: &[TaskResult]) -> Result<&str, Unverifiable> {
    let mut saw_payload = false;
    for entry in results {
        let Some(payload) = entry.result.as_ref() else {
            continue;
        };
        saw_payload = true;
        if let Some(text) = payload.get("content").and_then(|v| v.as_str()) {
            return Ok(text);
        }
        if let Some(text) = payload.as_str() {
            return Ok(text);
        }
    }
    Err(if saw_payload {
        Unverifiable::ResultNotReadable
    } else {
        Unverifiable::NoResult
    })
}

/// Compare a DECLARED expectation against what the run actually answered.
///
/// `expectation` is expected to arrive already normalised by
/// [`declared_expectation`] (it is trimmed again here so the rule holds for any
/// caller); an empty one never reaches this function, because an empty
/// declaration is no declaration and nothing is compared at all.
///
/// PURE, and deliberately: this is the whole of the judgement, unit-testable
/// without a `SidecarState`, a store or a dispatch in the loop.
pub(crate) fn verify(expectation: &str, results: &[TaskResult]) -> Verification {
    match answer_text(results) {
        Ok(answer) => {
            if answer.trim().contains(expectation.trim()) {
                Verification::Matched
            } else {
                Verification::NotMatched
            }
        }
        Err(reason) => Verification::Unverifiable(reason),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answered(payload: serde_json::Value) -> Vec<TaskResult> {
        vec![TaskResult {
            status: "ok".to_string(),
            result: Some(payload),
            error: None,
        }]
    }

    fn errored() -> Vec<TaskResult> {
        vec![TaskResult {
            status: "error".to_string(),
            result: None,
            error: Some("agent not loaded".to_string()),
        }]
    }

    #[test]
    fn the_2026_08_05_run_that_forced_this_reads_as_wrong() {
        // The operator asked for a count of `.md` files. The agent answered 58;
        // the answer is 59. The effort completed — `refarm.outcome` stayed
        // "done", which the observation tests pin — and the record had no way to
        // say the answer was wrong. This is that comparison.
        let verdict = verify("59", &answered(serde_json::json!({ "content": "58" })));
        assert_eq!(verdict, Verification::NotMatched);
        assert_eq!(verdict.passed(), Some(false));
        assert_eq!(verdict.method(), Some(METHOD_SUBSTRING));
        assert_eq!(verdict.unknown(), None);
    }

    #[test]
    fn an_answer_containing_the_expectation_matches() {
        let verdict = verify(
            "59",
            &answered(serde_json::json!({ "content": "There are 59 .md files in that directory." })),
        );
        assert_eq!(verdict, Verification::Matched);
        assert_eq!(verdict.passed(), Some(true));
        assert_eq!(verdict.method(), Some(METHOD_SUBSTRING));
    }

    #[test]
    fn a_bare_string_result_is_an_answer_too() {
        assert_eq!(verify("ok", &answered(serde_json::json!("ok"))), Verification::Matched);
        assert_eq!(verify("ok", &answered(serde_json::json!("no"))), Verification::NotMatched);
    }

    #[test]
    fn both_sides_are_trimmed_before_the_comparison() {
        assert_eq!(
            verify("  59  ", &answered(serde_json::json!({ "content": "\n  59  \n" }))),
            Verification::Matched,
        );
    }

    #[test]
    fn the_match_is_case_sensitive_which_is_the_declared_rule_not_an_oversight() {
        // Stated in METHOD_SUBSTRING's doc, so a reader of an old row knows what
        // `true` asserted. A case-insensitive matcher is a DIFFERENT method and
        // would arrive under a different `refarm.verification.method` value.
        assert_eq!(
            verify("Yes", &answered(serde_json::json!({ "content": "yes" }))),
            Verification::NotMatched,
        );
    }

    #[test]
    fn a_run_that_left_no_result_is_unverifiable_never_wrong() {
        // The heart of the three-state rule: a failed/cancelled/timed-out effort
        // carries an error, not an answer. Recording `false` here would accuse a
        // model of being wrong when nobody looked at anything.
        let verdict = verify("59", &errored());
        assert_eq!(verdict, Verification::Unverifiable(Unverifiable::NoResult));
        assert_eq!(verdict.passed(), None, "not false — nobody compared anything");
        assert_eq!(verdict.method(), None, "no method ran, so none is claimed");
        assert_eq!(verdict.unknown(), Some("no-result"));
    }

    #[test]
    fn an_effort_with_no_results_at_all_is_unverifiable_for_the_same_reason() {
        let verdict = verify("59", &[]);
        assert_eq!(verdict.passed(), None);
        assert_eq!(verdict.unknown(), Some("no-result"));
    }

    #[test]
    fn a_result_this_matcher_cannot_read_is_a_gap_in_the_checking_not_a_wrong_answer() {
        // An event dispatch's delivery receipt. It IS a result; it is not an
        // answer, and the reason says so separately from "there was nothing".
        let verdict = verify(
            "user:prompt",
            &answered(serde_json::json!({ "dispatched": "user:prompt", "sent": 1 })),
        );
        assert_eq!(verdict, Verification::Unverifiable(Unverifiable::ResultNotReadable));
        assert_eq!(verdict.passed(), None, "a receipt is not a wrong answer");
        assert_eq!(verdict.unknown(), Some("result-not-readable"));
    }

    #[test]
    fn a_non_string_content_is_not_readable_rather_than_stringified() {
        // Stringifying would let `"59"` match the number 592 or a nested field.
        let verdict = verify("59", &answered(serde_json::json!({ "content": 59 })));
        assert_eq!(verdict.passed(), None);
        assert_eq!(verdict.unknown(), Some("result-not-readable"));
    }

    #[test]
    fn the_first_readable_result_wins_over_an_earlier_unreadable_one() {
        let results = vec![
            TaskResult {
                status: "ok".to_string(),
                result: Some(serde_json::json!({ "dispatched": "x" })),
                error: None,
            },
            TaskResult {
                status: "ok".to_string(),
                result: Some(serde_json::json!({ "content": "59" })),
                error: None,
            },
        ];
        assert_eq!(verify("59", &results), Verification::Matched);
    }

    #[test]
    fn passed_and_unknown_are_complementary_never_both_and_never_neither() {
        for verdict in [
            Verification::Matched,
            Verification::NotMatched,
            Verification::Unverifiable(Unverifiable::NoResult),
            Verification::Unverifiable(Unverifiable::ResultNotReadable),
        ] {
            assert_eq!(
                verdict.passed().is_some(),
                verdict.unknown().is_none(),
                "a verdict and a reason for having no verdict cannot both be true: {verdict:?}"
            );
            assert_eq!(
                verdict.method().is_some(),
                verdict.passed().is_some(),
                "the method rides with the verdict, always: {verdict:?}"
            );
        }
    }

    #[test]
    fn an_empty_declaration_is_no_declaration_because_it_would_pass_against_anything() {
        assert_eq!(declared_expectation(Some("59")), Some("59".to_string()));
        assert_eq!(declared_expectation(Some("  59  ")), Some("59".to_string()));
        assert_eq!(declared_expectation(Some("")), None);
        assert_eq!(declared_expectation(Some("   ")), None);
        assert_eq!(declared_expectation(None), None);
    }
}
