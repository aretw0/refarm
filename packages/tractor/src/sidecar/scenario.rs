//! `refarm.scenario.*` — WHICH WORK a run was, so that two runs become
//! comparable. This is the field the `BudgetObservation` record
//! (`observation.rs`) was missing: it already carries what a run cost, what
//! governed it, where it stopped, on which node and under which rate table, but
//! without the identity of the question being asked, "sonnet spent 12k tokens"
//! and "opus spent 30k tokens" are two facts about two different things.
//!
//! The record used to write both fields as an explicit `null`, on the premise
//! that only a synthetic bench declares a scenario and field use has none. That
//! premise is what this module reverses — the operator wants *daily work itself*
//! to answer which models are better, which requires the daily work to be
//! identifiable, not a separate benchmark to be built.
//!
//! **The two fields are different in kind, on purpose:**
//!
//! - `refarm.scenario.id` is **DECLARED**. A caller says "this run is scenario
//!   X" (`refarm dispatch --scenario X` → `Effort.scenarioId` on the wire). A
//!   scenario id is a *claim of equivalence* between runs — "these are the same
//!   task, compare them" — and only the caller who knows that is entitled to
//!   make it. When nobody declares one the field is **absent**: not null, not an
//!   invented id, not a fallback to the hash.
//! - `refarm.scenario.hash` is **DERIVED**, from the request shape alone. It
//!   answers the narrower question "was this literally the same request?"
//!   without anyone declaring anything, which is what makes ordinary field use
//!   comparable at all — the operator does not label their own work, and asking
//!   them to would rebuild the synthetic benchmark this design exists to avoid.
//!
//! **What the hash covers, and what it deliberately does not.** For every task
//! the effort carries, in submitted order: the task's `pluginId`, its effective
//! verb, and its `args`. Nothing else. The task's own `id` (a per-submission
//! uuid), the effort's `id`, `submittedAt`, `source`/spawner, `direction`,
//! `workspaceId` and — above all — its `budget` are EXCLUDED. Those are the
//! conditions the work ran under, not the work. Folding a budget in would be
//! actively self-defeating: running the same question under two deadlines and
//! comparing the outcomes is the entire question this record exists to answer,
//! and a budget inside the hash would file those two runs as two unrelated
//! scenarios. One key INSIDE `args` is excluded for the same reason the ids are
//! — see `RUN_CORRELATION_ARG`.
//!
//! **What the hash does NOT claim.** That two runs asking *different* things are
//! the same task. A prompt reworded, or the same question put to two models
//! (`args.model` on the agent's `respond`, `args.session_id` beside it), are
//! different requests and hash differently — correctly, because the hash's whole
//! guarantee is that two rows sharing one are genuinely the same request.
//! Grouping runs that DIFFER is exactly the claim `refarm.scenario.id` exists to
//! carry, which is why it is declared by a caller and not derived here.
//! Over-grouping would quietly poison every comparison built on this field;
//! under-grouping only leaves signal on the table for a declaration to pick up.
//!
//! Neither field is ever fabricated. A hash that cannot be computed (an effort
//! with no tasks) is absent, exactly as an undeterminable count is absent
//! elsewhere on this record — D6 of the budget-laboratory design. A scenario
//! that is silently wrong would poison every comparison built on top of it,
//! which is strictly worse than having none.

use super::EffortTask;

/// What `dispatch_effort` resolved about WHICH WORK an effort is, stashed by
/// `dispatch::dispatched_scenarios` for `record_budget_observation` to read back
/// at finalisation — the same dispatch→finalisation hand-off
/// `dispatch::dispatched_budgets` performs for the resolved budget, and for the
/// same structural reason: the input it derives from (`Effort.tasks`, plus the
/// caller's own declaration) is in hand at dispatch and nowhere else at the end.
///
/// The two halves ride together and are TAKEN together, so an effort whose
/// resolution was never stashed records **neither** field rather than half of
/// one — a lone hash on a run whose declared id was lost would read as
/// "undeclared" and quietly split one scenario into two.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct DispatchedScenario {
    /// The caller's declaration, already normalised by `declared_scenario_id`.
    pub(crate) id: Option<String>,
    /// `sha256:<hex>` over the canonical request shape — see `scenario_hash`.
    pub(crate) hash: Option<String>,
}

/// The verb a task with no declared `fn` actually runs — the same
/// `task.fn_name.as_deref().unwrap_or("respond")` `dispatch_effort` itself
/// applies before routing. Normalised INTO the hash rather than hashed as an
/// absence, so `{"fn": null}` and `{"fn": "respond"}` — one dispatch, spelled
/// two ways by two surfaces — resolve to one scenario.
const DEFAULT_FN: &str = "respond";

/// The one arg key that is an IDENTIFIER of this run rather than any part of the
/// question, dropped before hashing.
///
/// `buildDispatchEffort` (`packages/capabilities-v1/src/plugin-bridge.ts`) writes
/// `args.replyRef = effortId` on every `refarm dispatch`, so the plugin's
/// out-of-band `DispatchResult` can be correlated back. It is a fresh uuid per
/// submission and can never be operator-supplied (the builder overwrites
/// whatever `key=value` parsing produced), which makes it exactly as much a
/// per-run identifier as `EffortTask.id` or `Effort.id` — both already excluded
/// by never entering the document at all. Leaving it in would give every single
/// `refarm dispatch` a unique hash and make the derived half of this record
/// worthless on the very surface `--scenario` is being added to.
///
/// Top level of `args` only, not recursive: that is the one place the builder
/// puts it, and a `replyRef` nested inside an operator's own structured value
/// would be that operator's data.
const RUN_CORRELATION_ARG: &str = "replyRef";

/// The second per-run identifier, found by MEASURING the first version of this
/// file rather than by reading it.
///
/// `runtime-agent-effort.ts` writes `args.session_id` on every `refarm ask`, and
/// `ask` mints a fresh session whenever the operator has no active one — so two
/// runs of the identical question produced two different hashes. Verified live:
/// the same prompt asked twice landed as `sha256:c7b41dab…` and
/// `sha256:44a21c00…`, grouping nothing.
///
/// It was left in on the reasoning that stripping identifiers over-groups and
/// manufactures false equivalences. That reasoning is right about `model` and
/// `provider` — two models asked the same question ARE two different requests,
/// and grouping them is what a DECLARED id is for. It is wrong about a session:
/// a session is the container the work happened in, never any part of what the
/// work IS, which is the same category as `replyRef` above.
///
/// The consequence of the earlier choice was not subtle: the derived half of
/// this record was inert on `refarm ask`, which is the one surface where model
/// comparison actually lives.
const SESSION_CONTAINER_ARG: &str = "session_id";

/// Normalise a declared scenario id: trimmed, and an empty declaration read as
/// no declaration at all.
///
/// `""` is not an id. Accepting one would stamp a scenario onto the record that
/// no caller can ever ask for again, and every such run would aggregate together
/// under a name meaning nothing — the precise failure mode "absent, never
/// fabricated" exists to prevent, arrived at from the other direction.
pub(crate) fn declared_scenario_id(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// One task reduced to WHAT IT ASKS: plugin, effective verb, args. The key names
/// are the wire's own camelCase (`pluginId`, `fn`, `args`), not Rust field
/// names, so a TS surface computing this hash for the same dispatch builds the
/// identical document.
///
/// An absent `args` (serde's `Value::Null` default for the field) is normalised
/// to the empty object: `refarm dispatch` always sends `{}` while a hand-written
/// `POST /efforts` may omit the key entirely, and those are the same request.
/// The requirement is that the same question hashes the same *from different
/// surfaces*, which this is the only place that can be honoured.
fn task_shape(task: &EffortTask) -> serde_json::Value {
    let mut args = match &task.args {
        serde_json::Value::Null => serde_json::Value::Object(serde_json::Map::new()),
        other => other.clone(),
    };
    if let Some(map) = args.as_object_mut() {
        map.remove(RUN_CORRELATION_ARG);
        map.remove(SESSION_CONTAINER_ARG);
    }
    serde_json::json!({
        "pluginId": task.plugin_id,
        "fn": task.fn_name.as_deref().unwrap_or(DEFAULT_FN),
        "args": args,
    })
}

/// A stable hash over an effort's whole request shape, or `None` when there is
/// no request to hash.
///
/// **Key ordering is the classic trap and is closed here**: `{"a":1,"b":2}` and
/// `{"b":2,"a":1}` are the same request and must hash identically, so the
/// document goes through `crate::host::canonical_json` — recursively key-sorted
/// objects, arrays in order, JS-compatible number formatting — before the
/// digest. That is the same canonical form the config node's revision uses, on
/// purpose: two canonicalisers is how two digests over "the same" JSON drift
/// apart.
///
/// **ALL tasks, in submitted order.** An effort carries `tasks: Vec<EffortTask>`
/// and today's dispatcher only ever executes `tasks.first()`, but the hash
/// describes the request as SUBMITTED: two submissions differing only in their
/// tail are different requests, and hashing the head alone would file them as
/// one scenario — a silent lie that gets worse, not better, the day the
/// dispatcher learns to run the rest. Order is preserved rather than sorted:
/// nothing about a task list is commutative, and claiming it is would merge two
/// genuinely different requests.
///
/// **Absent, never fabricated**: an effort with no tasks has no request shape,
/// so it gets no hash (D6). It is also the effort `dispatch_effort` finalises as
/// `failed: effort has no tasks`, so there is nothing to describe.
///
/// The digest is prefixed `sha256:` rather than left as bare hex — the same
/// self-describing form the config node's `revision` carries — so that a future
/// change of algorithm is visible in the data instead of silently making old and
/// new rows incomparable while still looking like the same kind of value.
pub(crate) fn scenario_hash(tasks: &[EffortTask]) -> Option<String> {
    if tasks.is_empty() {
        return None;
    }
    let shape = serde_json::Value::Array(tasks.iter().map(task_shape).collect());
    let digest = super::auth::sha256_hex(&crate::host::canonical_json(&shape));
    Some(format!("sha256:{digest}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn task(plugin_id: &str, fn_name: Option<&str>, args: serde_json::Value) -> EffortTask {
        EffortTask {
            id: uuid::Uuid::new_v4().to_string(),
            plugin_id: plugin_id.to_string(),
            fn_name: fn_name.map(str::to_string),
            args,
        }
    }

    fn hash_of(tasks: Vec<EffortTask>) -> String {
        scenario_hash(&tasks).expect("a hashable request")
    }

    #[test]
    fn key_order_in_the_args_does_not_change_the_hash() {
        // The classic trap: serde_json with `preserve_order` (or any surface
        // serialising an object literal) hands these over in the order written.
        // They are the same request and must be one scenario.
        let a = hash_of(vec![task(
            "@refarm/agent",
            Some("respond"),
            serde_json::json!({ "prompt": "summarise", "model": "sonnet", "nested": { "x": 1, "y": 2 } }),
        )]);
        let b = hash_of(vec![task(
            "@refarm/agent",
            Some("respond"),
            serde_json::json!({ "nested": { "y": 2, "x": 1 }, "model": "sonnet", "prompt": "summarise" }),
        )]);
        assert_eq!(a, b, "key order is not part of what the work IS");
    }

    #[test]
    fn the_hash_is_stable_across_the_per_submission_task_id() {
        // `EffortTask.id` is a fresh uuid per submission — the same question
        // asked twice must not look like two scenarios.
        let args = serde_json::json!({ "prompt": "ping" });
        assert_eq!(
            hash_of(vec![task("@refarm/agent", Some("respond"), args.clone())]),
            hash_of(vec![task("@refarm/agent", Some("respond"), args)]),
        );
    }

    #[test]
    fn a_different_prompt_verb_or_plugin_hashes_differently() {
        let base = hash_of(vec![task(
            "@refarm/agent",
            Some("respond"),
            serde_json::json!({ "prompt": "summarise" }),
        )]);
        let other_prompt = hash_of(vec![task(
            "@refarm/agent",
            Some("respond"),
            serde_json::json!({ "prompt": "translate" }),
        )]);
        let other_verb = hash_of(vec![task(
            "@refarm/agent",
            Some("extract"),
            serde_json::json!({ "prompt": "summarise" }),
        )]);
        let other_plugin = hash_of(vec![task(
            "vault",
            Some("respond"),
            serde_json::json!({ "prompt": "summarise" }),
        )]);
        assert_ne!(base, other_prompt);
        assert_ne!(base, other_verb);
        assert_ne!(base, other_plugin);
    }

    #[test]
    fn an_undeclared_verb_hashes_as_the_respond_it_actually_runs() {
        assert_eq!(
            hash_of(vec![task("@refarm/agent", None, serde_json::json!({ "prompt": "ping" }))]),
            hash_of(vec![task(
                "@refarm/agent",
                Some("respond"),
                serde_json::json!({ "prompt": "ping" })
            )]),
        );
    }

    #[test]
    fn absent_args_and_empty_args_are_one_request() {
        // A hand-written POST omits `args`; `refarm dispatch` always sends `{}`.
        assert_eq!(
            hash_of(vec![task("vault", Some("extract"), serde_json::Value::Null)]),
            hash_of(vec![task("vault", Some("extract"), serde_json::json!({}))]),
        );
    }

    #[test]
    fn every_task_is_hashed_not_only_the_first() {
        let head = task("vault", Some("extract"), serde_json::json!({ "path": "a.md" }));
        let tail = task("vault", Some("index"), serde_json::json!({ "path": "b.md" }));
        let other_tail = task("vault", Some("index"), serde_json::json!({ "path": "c.md" }));
        assert_ne!(
            hash_of(vec![head.clone(), tail.clone()]),
            hash_of(vec![head.clone(), other_tail]),
            "a difference in the tail is a different request, not the same scenario"
        );
        assert_ne!(
            hash_of(vec![head.clone()]),
            hash_of(vec![head.clone(), tail.clone()]),
            "one task and two tasks are not the same request"
        );
        assert_ne!(
            hash_of(vec![head.clone(), tail.clone()]),
            hash_of(vec![tail, head]),
            "task order is preserved — nothing here is commutative"
        );
    }

    #[test]
    fn the_per_run_reply_ref_inside_args_does_not_reach_the_hash() {
        // `buildDispatchEffort` stamps `args.replyRef = effortId` on EVERY
        // `refarm dispatch`. Left in, every dispatch would hash uniquely and the
        // derived half of the record would be worthless on the exact surface
        // `--scenario` is being added to.
        assert_eq!(
            hash_of(vec![task(
                "vault",
                Some("extract"),
                serde_json::json!({ "path": "n.md", "replyRef": "eff-1" })
            )]),
            hash_of(vec![task(
                "vault",
                Some("extract"),
                serde_json::json!({ "path": "n.md", "replyRef": "eff-2" })
            )]),
            "the effort's own correlation id is an identifier of the run, not of the work"
        );
        assert_eq!(
            hash_of(vec![task(
                "vault",
                Some("extract"),
                serde_json::json!({ "path": "n.md", "replyRef": "eff-1" })
            )]),
            hash_of(vec![task("vault", Some("extract"), serde_json::json!({ "path": "n.md" }))]),
            "a dispatch through the CLI and the same request without a replyRef are one scenario"
        );
    }

    #[test]
    fn a_nested_reply_ref_is_the_operators_own_data_and_stays_in() {
        // The exclusion is top-level-of-args only: the builder puts it there and
        // nowhere else, so a `replyRef` inside a structured value the operator
        // passed is content, not correlation.
        assert_ne!(
            hash_of(vec![task(
                "vault",
                Some("extract"),
                serde_json::json!({ "note": { "replyRef": "a" } })
            )]),
            hash_of(vec![task(
                "vault",
                Some("extract"),
                serde_json::json!({ "note": { "replyRef": "b" } })
            )]),
        );
    }

    #[test]
    fn a_non_object_args_value_still_hashes_rather_than_panicking() {
        // `args` is a bare `Value` on the wire — nothing forces it to be an
        // object. A scalar or array arg must still produce a hash (the run is
        // real either way), and different ones must differ.
        assert_ne!(
            hash_of(vec![task("vault", Some("extract"), serde_json::json!(["a", "b"]))]),
            hash_of(vec![task("vault", Some("extract"), serde_json::json!(["b", "a"]))]),
        );
        assert_eq!(
            hash_of(vec![task("vault", Some("extract"), serde_json::json!("bare"))]),
            hash_of(vec![task("vault", Some("extract"), serde_json::json!("bare"))]),
        );
    }

    #[test]
    fn an_effort_with_no_tasks_has_no_hash() {
        assert_eq!(scenario_hash(&[]), None, "no request shape, so no hash — never a fabricated one");
    }

    #[test]
    fn the_digest_is_a_prefixed_lowercase_sha256() {
        let hash = hash_of(vec![task("vault", Some("extract"), serde_json::json!({}))]);
        let hex = hash.strip_prefix("sha256:").expect("a self-describing algorithm prefix");
        assert_eq!(hex.len(), 64);
        assert!(hex.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn a_declared_id_is_trimmed_and_an_empty_declaration_is_no_declaration() {
        assert_eq!(declared_scenario_id(Some("summarise-v1")), Some("summarise-v1".to_string()));
        assert_eq!(declared_scenario_id(Some("  summarise-v1  ")), Some("summarise-v1".to_string()));
        assert_eq!(declared_scenario_id(Some("")), None);
        assert_eq!(declared_scenario_id(Some("   ")), None);
        assert_eq!(declared_scenario_id(None), None);
    }

    #[test]
    fn the_same_question_in_two_sessions_is_one_scenario() {
        // Measured live on 2026-08-05, before this exclusion existed: `refarm ask` mints a
        // fresh session whenever the operator has no active one, so the identical prompt
        // asked twice landed as sha256:c7b41dab… and sha256:44a21c00…. The derived half of
        // this record was inert on the one surface where model comparison actually lives.
        let shape = |session: &str| {
            hash_of(vec![task(
                "@refarm/agent",
                Some("respond"),
                serde_json::json!({ "prompt": "responda apenas: ok", "session_id": session }),
            )])
        };
        assert_eq!(
            shape("urn:sovereign:session:v1:aaa"),
            shape("urn:sovereign:session:v1:bbb"),
            "a session is the container the work happened in, never part of what the work IS"
        );
    }

    #[test]
    fn two_models_asked_the_same_question_stay_two_scenarios() {
        // The other half of the same judgement, and it must NOT collapse. Two models asked
        // one question are two different requests; grouping them is what a DECLARED id is
        // for, and doing it here would manufacture a false equivalence the record could
        // never take back.
        let shape = |model: &str| {
            hash_of(vec![task(
                "@refarm/agent",
                Some("respond"),
                serde_json::json!({ "prompt": "same", "model": model }),
            )])
        };
        assert_ne!(shape("gpt-5.5"), shape("claude-sonnet-5"));
    }
}
