//! The `BudgetObservation` record — Task 10 of the budget laboratory: every
//! terminal effort leaves a durable node carrying the budget that governed it,
//! which level bound it, what it actually spent, and where it stopped. Written
//! into the SAME CRDT node store as the `UsageRecord` it joins to, which has no
//! TTL — unlike the effort results, which are reaped at 24h under a premise
//! that was right for operational state and wrong for evidence. A policy can
//! later be derived from this evidence instead of from a constant.
//!
//! `build_observation_node` is the PURE node-shape builder, tested directly in
//! `sidecar/tests/observation.rs` without any storage in the loop.
//! `write_budget_observation` is the one impure call site — resolving the
//! effort's label fields, joining usage, and storing the node — called from
//! `dispatch::finalise_effort`, the single place every terminal path passes
//! through.
//!
//! Records WHICH NODE ran the effort as of the node-identity work: `host.name`
//! (declared, mutable) and `host.id` (opaque, per-installation, never replicated) —
//! see `node_identity.rs` for the two identifiers and why they resolve so
//! differently, and `node_descriptor.rs` for the OTHER place they are published.
//!
//! Records WHICH WORK the effort was as of the scenario work: `refarm.scenario.id`
//! (declared by a caller) and `refarm.scenario.hash` (derived from the request
//! shape) — see `scenario.rs` for why those two are different in kind, what the
//! hash covers, and what it deliberately excludes. Both are resolved at DISPATCH
//! and read back here, the same hand-off the resolved budget uses.
//!
//! Records WHETHER THE RUN WAS RIGHT as of the verification work:
//! `refarm.verification.expected` / `.passed` / `.method` / `.unknown` — a
//! SEPARATE fact from `refarm.outcome`, which continues to mean only that the
//! effort reached that terminal status. See `verification.rs` for the three
//! states, why a declared-but-uncomparable expectation is not `false`, and what
//! a substring matcher cannot grade.

use super::SidecarState;

pub(crate) struct ObservationInput<'a> {
    pub effort_id: &'a str,
    pub prompt_ref: Option<&'a str>,
    pub workspace_id: Option<&'a str>,
    /// HOW `workspace_id` was decided. Rides with it or not at all — a record that names a
    /// workspace without saying whether the run CLAIMED it or was GUESSED into it cannot be
    /// aggregated: "spend on rcdc5" would silently mix money the operator attributed there with
    /// money attributed by a directory that looked like it (ISS-058).
    pub workspace_source: Option<&'a str>,
    pub spawner: Option<&'a str>,
    pub outcome: &'a str,
    /// `None` when `EffortResult.submitted_at`/`completed_at` could not both be
    /// parsed — omitted via `put_opt`, never a fabricated elapsed time (D6). A
    /// timestamp-parse failure costs only this field, not the rest of the
    /// record (round-1 fix: it used to drop the whole observation).
    pub elapsed_ms: Option<u64>,
    /// The `N` and the `M` of *"died at N/M"*, both counting completion-loop
    /// steps, both absent together when the joined record established neither.
    /// See `steps_from_usage` for why a numerator may nonetheless arrive without
    /// its denominator, and why that records exactly one of the two.
    pub steps_completed: Option<u32>,
    pub steps_planned: Option<u32>,
    /// How many whole dispatches this run folded in — a different notion from
    /// the step pair above, with no ceiling anywhere to pair it against.
    pub turns_completed: Option<u32>,
    /// `None` when no dispatch-time resolution was found for this effort (a
    /// restart mid-run). The budget family is then OMITTED from the node
    /// entirely, never re-resolved — D6, and see `dispatch::dispatched_budgets`'s
    /// doc for why re-resolving here would reintroduce round-1's Critical defect.
    pub resolved: Option<super::budget::ResolvedBudget>,
    /// The RAW `UsageRecord` node from `dispatch::find_usage_record_for`,
    /// already joined on prompt_ref — NOT `dispatch::find_usage_for`'s device
    /// wire view, whose back-compat `count` helper defaults absent cache/price
    /// fields to `0` (correct for a device client, wrong for a durable record;
    /// see that function's doc — F4). `put_usage` below reads presence
    /// straight off this node. FLATTENED onto the observation under OTel names
    /// — never nested (D2).
    pub usage: Option<serde_json::Value>,
    /// This node's DECLARED name (`config.json`'s `node.name`), resolved live by the one
    /// impure call site (`write_budget_observation`) via `node_identity::declared_node_name`
    /// — `None` when nobody has declared one yet. See `node_identity.rs` for why this
    /// identifier is mutable/portable while `node_id` below is neither.
    pub node_name: Option<&'a str>,
    /// This node's opaque, per-installation id (`node_identity::load_or_create_node_id`) —
    /// `None` only when this boot could not establish one (a corrupt file, or a failed
    /// first-boot persist — see that function's doc). Never derived from anything that
    /// could be shared across machines.
    pub node_id: Option<&'a str>,
    /// The scenario a caller DECLARED this run to be an instance of. `None` —
    /// and therefore the field absent — for the whole of undeclared field use,
    /// which is most of it. Never invented and never back-filled from the hash
    /// below: an id is a claim of equivalence between runs, and only the caller
    /// can make it. See `sidecar::scenario` for the full distinction.
    pub scenario_id: Option<&'a str>,
    /// The hash DERIVED from this run's request shape (plugin, verb, args),
    /// which is what makes undeclared field use comparable at all. `None` when
    /// no dispatch-time resolution was stashed for this effort (a restart
    /// mid-run) or when there was no request to hash — omitted, per D6, rather
    /// than reconstructed here. Arrives together with `scenario_id` from the one
    /// `DispatchedScenario` `record_budget_observation` took.
    pub scenario_hash: Option<&'a str>,
    /// What the caller declared this run's answer must contain, and what
    /// comparing it produced. `None` — and therefore NO verification key at all
    /// on the node — for the whole of undeclared field use, which is nearly all
    /// of it, and that stays the default.
    ///
    /// The expectation and the verdict ride as ONE value on purpose: a verdict
    /// with no expectation beside it cannot be re-read ("false against what?"),
    /// and an expectation with no verdict slot would have nowhere to say it was
    /// unverifiable. See `sidecar::verification` for the three states and why a
    /// declared-but-uncomparable expectation is emphatically not `false`.
    pub verification: Option<super::verification::DeclaredVerification<'a>>,
}

/// Mint the `@id` for a new `BudgetObservation` node. Local to this module
/// rather than a shared crate helper: `mint_urn`-shaped helpers in this crate
/// are per-module (`streaming::observations::stream_chunk_observation_id` is
/// the precedent), not a single crate-root utility.
fn mint_observation_id() -> String {
    format!("urn:tractor:budget-observation:{}", uuid::Uuid::new_v4())
}

/// Current time in nanoseconds since the epoch. Local copy of the same
/// zero-dependency pattern used elsewhere in this crate
/// (`host::wasi_bridge::model_stream_events::now_ns`,
/// `host::host_effects_bridge::connection_host::now_ns`) — each caller owns
/// its own, rather than reaching across a module boundary for it.
fn now_ns() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

/// Copy the joined UsageRecord onto the node under the OTel names D2 promises.
/// Flat, never nested: a dataset consumer reading `gen_ai.usage.input_tokens`
/// must find it at that key, or adopting the vocabulary was decorative.
/// A field the joined record does not carry is OMITTED, per D6 — a run whose
/// usage never landed is not a run that used zero tokens.
///
/// `usage` is the RAW `UsageRecord` node (`dispatch::find_usage_record_for`) —
/// every field this function copies lives at ITS top level, so `u = usage`
/// falls out of the `unwrap_or` below unchanged; the `usage.get("usage")`
/// branch only ever matched a test fixture shaped like the device wire view
/// and is kept so those fixtures (`sidecar/tests/observation.rs`) still pass
/// unmodified. Reading the raw node rather than `find_usage_for`'s view is
/// F4's fix: that view's `count` helper defaults an absent cache/price field
/// to `0` for the device wire contract's back-compat guarantee, which is
/// wrong for a durable record — a pre-split `UsageRecord` genuinely lacks
/// `cache_read_input_tokens`/`cache_creation_input_tokens`, and copying from
/// the raw node lets that absence read as absence here too.
fn put_usage(
    map: &mut serde_json::Map<String, serde_json::Value>,
    usage: Option<&serde_json::Value>,
) {
    let Some(usage) = usage else { return };
    let u = usage.get("usage").unwrap_or(usage);
    let mut copy = |from: &str, to: &str| {
        if let Some(v) = u.get(from) {
            map.insert(to.to_string(), v.clone());
        }
    };
    copy("tokens_in", "gen_ai.usage.input_tokens");
    copy("tokens_out", "gen_ai.usage.output_tokens");
    copy("tokens_reasoning", "gen_ai.usage.reasoning.output_tokens");
    copy("cache_read_input_tokens", "gen_ai.usage.cache_read.input_tokens");
    copy(
        "cache_creation_input_tokens",
        "gen_ai.usage.cache_creation.input_tokens",
    );
    copy("estimated_usd", "refarm.cost.estimated_usd");
    // Whether `estimated_usd` above is a real price or a structural/unpriced
    // zero (F5) — "I could not price this" must not read as "this was cheap".
    // Absent on a record written before this field existed, per D6.
    copy("price_known", "refarm.cost.price_known");
    // Which rate table priced this run. Joined from the UsageRecord rather than
    // read locally, because `packages/tractor` does NOT depend on the agent
    // crate — the agent is a WASM guest loaded at runtime, and RATE_TABLE_VERSION
    // lives there. The version belongs to whoever computed the price, so it
    // travels WITH the price. Without it, a later correction to the table cannot
    // tell which historical records predate it and recomputing becomes guesswork:
    // tokens do not drift, prices do, so the record stamps the thing that drifts
    // and keeps the thing that does not.
    copy("rate_table_version", "refarm.cost.rate_table_version");
    if let Some(v) = usage.get("provider") {
        map.insert("gen_ai.provider.name".into(), v.clone());
    }
    if let Some(v) = usage.get("model") {
        map.insert("gen_ai.request.model".into(), v.clone());
    }
    if let Some(v) = u.get("pricing_mode") {
        map.insert("refarm.pricing_mode".into(), v.clone());
    }
}

/// Read one `u32` counter off the raw `UsageRecord` the agent crate stamped
/// (`packages/agent/src/response_nodes.rs`). `None` when the joined record does
/// not carry that key — a record written before the field existed, or no usage
/// joined at all for this run — per D6, absent rather than a fabricated zero.
/// Always TOP-LEVEL on the raw node (never nested under a legacy `usage.usage`
/// shape — see `put_usage`'s doc).
fn usage_count(usage: Option<&serde_json::Value>, key: &str) -> Option<u32> {
    usage?.get(key)?.as_u64().map(|v| v as u32)
}

/// The two halves of *"died at 4/25"*
/// (`docs/superpowers/specs/2026-08-03-budget-laboratory-design.md`, F1), read
/// as ONE value from the ONE record that carries both. The agent writes them
/// together or not at all (`provider_runtime::loop_progress`), and this reads
/// them the same way, so an observation can never pair a numerator with a
/// denominator that measured something else.
///
/// Both count completion-loop STEPS: `steps_completed` is the `N` and
/// `steps_planned` the `M` of the `step N/M` the sidecar rendered live from
/// `agent:iteration` (`agent_activity.rs`), on this very same `prompt_ref`.
///
/// Reading them independently is deliberate all the same: a `UsageRecord` from
/// an older agent carries a numerator with no denominator, and the honest record
/// of that run is the numerator plus NO `steps_planned` key — never a `25`
/// invented here from the current default.
fn steps_from_usage(usage: Option<&serde_json::Value>) -> (Option<u32>, Option<u32>) {
    (
        usage_count(usage, "steps_completed"),
        usage_count(usage, "steps_planned"),
    )
}

fn axis_level_str(level: super::budget::BudgetLevel) -> &'static str {
    match level {
        super::budget::BudgetLevel::Node => "node",
        super::budget::BudgetLevel::Workspace => "workspace",
        super::budget::BudgetLevel::Declared => "declared",
        super::budget::BudgetLevel::Default => "default",
    }
}

/// Insert only when the value exists. D6: an omitted field means "not
/// determined"; a zero means "determined to be zero". Aggregating a mixture of
/// the two silently averages a lie.
fn put_opt(map: &mut serde_json::Map<String, serde_json::Value>, key: &str, value: Option<serde_json::Value>) {
    if let Some(v) = value {
        map.insert(key.to_string(), v);
    }
}

pub(crate) fn build_observation_node(input: ObservationInput<'_>) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    map.insert("@type".into(), "BudgetObservation".into());
    map.insert("@id".into(), mint_observation_id().into());
    map.insert("effort_id".into(), input.effort_id.into());
    map.insert("refarm.outcome".into(), input.outcome.into());
    put_opt(&mut map, "refarm.elapsed_ms", input.elapsed_ms.map(Into::into));

    // The whole `refarm.budget.*` family rides together, or not at all: a
    // dispatch-time resolution that was never found (round-1 fix) must not
    // read as "this axis resolved to nothing declared" (`.declared: null`
    // below already means that for a DIFFERENT reason — nobody asked for a
    // ceiling on that axis). Omitted, per D6, rather than reconstructed.
    if let Some(b) = input.resolved {
        map.insert("refarm.budget.deadline_ms.effective".into(), b.deadline_ms.effective.into());
        map.insert("refarm.budget.max_tokens.effective".into(), b.max_tokens.effective.into());
        // Millis back to a decimal at the record boundary, where a human reads it.
        map.insert(
            "refarm.budget.max_usd.effective".into(),
            serde_json::json!(b.max_usd_millis.effective as f64 / 1000.0),
        );
        map.insert(
            "refarm.budget.deadline_ms.declared".into(),
            b.deadline_ms.declared.map(Into::into).unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "refarm.budget.max_tokens.declared".into(),
            b.max_tokens.declared.map(Into::into).unwrap_or(serde_json::Value::Null),
        );
        map.insert(
            "refarm.budget.max_usd.declared".into(),
            b.max_usd_millis
                .declared
                .map(|m| serde_json::json!(m as f64 / 1000.0))
                .unwrap_or(serde_json::Value::Null),
        );
        // The deadline is the axis that stops a run in practice, so its level is
        // the headline one. Per-axis levels ride beside it.
        map.insert("refarm.budget.bound_by".into(), axis_level_str(b.deadline_ms.bound_by).into());
        map.insert(
            "refarm.budget.bound_by.max_tokens".into(),
            axis_level_str(b.max_tokens.bound_by).into(),
        );
        map.insert(
            "refarm.budget.bound_by.max_usd".into(),
            axis_level_str(b.max_usd_millis.bound_by).into(),
        );
    }

    // WHICH WORK this was, so two runs can be compared — the one thing this
    // record lacked, and the premise ("field use has no scenario") that used to
    // write both of these as an explicit null. Two fields, different in kind:
    // `.id` is DECLARED by a caller, `.hash` is DERIVED from the request shape.
    // See `sidecar::scenario` for what goes into the hash and what is
    // deliberately excluded from it.
    //
    // OMITTED rather than null, per D6. The null they replace was on every
    // observation ever written, and a null meaning "nobody declared a scenario"
    // is indistinguishable, once a thousand rows are aggregated, from a null
    // meaning "we could not tell" — which is exactly the state a restart
    // mid-run leaves behind.
    put_opt(&mut map, "refarm.scenario.id", input.scenario_id.map(Into::into));
    put_opt(&mut map, "refarm.scenario.hash", input.scenario_hash.map(Into::into));

    // WHETHER THE RUN WAS RIGHT — the other thing this record could not say, and
    // the reason every reader was inferring correctness from `refarm.outcome`
    // above. These keys are written BESIDE that one and never into it:
    // `refarm.outcome` keeps meaning "the run completed", and a completed run
    // that answered wrongly is `outcome: "done"` + `verification.passed: false`.
    // Conflating them would destroy the distinction (2026-08-05: an agent
    // answered 58 where the answer was 59, and `done` was not the wrong word —
    // it was the only word).
    //
    // Absent when nobody declared an expectation, which is most of field use, so
    // every observation ever written stays valid unchanged. When one WAS
    // declared, `.expected` is always recorded (a verdict must be re-readable by
    // a human) and then exactly one of `.passed`+`.method` or `.unknown` — the
    // three-state rule, made structural by `Verification` rather than trusted to
    // the call sites here.
    if let Some(v) = input.verification {
        map.insert("refarm.verification.expected".into(), v.expected.into());
        put_opt(&mut map, "refarm.verification.passed", v.verdict.passed().map(Into::into));
        put_opt(&mut map, "refarm.verification.method", v.verdict.method().map(Into::into));
        put_opt(&mut map, "refarm.verification.unknown", v.verdict.unknown().map(Into::into));
    }

    put_opt(&mut map, "prompt_ref", input.prompt_ref.map(Into::into));
    put_opt(&mut map, "refarm.workspace.id", input.workspace_id.map(Into::into));
    // Beside the id, never inside it, and OMITTED rather than defaulted when unknown (D6): an
    // observation written before this field existed says nothing about provenance, and a
    // `"declared"` invented here would read to every future analysis as an operator's claim.
    put_opt(&mut map, "refarm.workspace.source", input.workspace_source.map(Into::into));
    put_opt(&mut map, "refarm.budget.spawner", input.spawner.map(Into::into));
    // WHICH NODE ran this — OTel's resource semantic conventions already speak here
    // (`host.name`/`host.id`, https://opentelemetry.io/docs/specs/semconv/resource/host/),
    // so this is `gen_ai.*`'s sibling rather than a `refarm.*` invention, per D2's rule.
    // `host.name` is the operator's declared, mutable label; `host.id` is the opaque,
    // stable, per-installation one — see `node_identity.rs` for why they resolve so
    // differently. Both OMITTED, never an empty string or a fabricated placeholder, when
    // this boot has nothing to report (D6): a node with no declared name records no
    // `host.name` key at all, which is also the honest measure of how much of the record
    // predates this change — every observation before today omits both.
    put_opt(&mut map, "host.name", input.node_name.map(Into::into));
    put_opt(&mut map, "host.id", input.node_id.map(Into::into));
    // *"died at 4/25"*, recoverable. Both keys omitted, never zeroed or
    // defaulted, when the run established no such measurement (D6) — a `0` or a
    // `25` here would read to every future analysis as a step budget that was
    // actually observed.
    put_opt(&mut map, "refarm.outcome.steps_completed", input.steps_completed.map(Into::into));
    put_opt(&mut map, "refarm.outcome.steps_planned", input.steps_planned.map(Into::into));
    // Spelled `turns`, not `steps`, because it counts dispatches — the two used
    // to share the `steps_completed` name, which made a `1` from this counter
    // read as the numerator of a step fraction it had nothing to do with.
    put_opt(&mut map, "refarm.outcome.turns_completed", input.turns_completed.map(Into::into));

    put_usage(&mut map, input.usage.as_ref());

    // A currency ceiling cannot bind where the estimate is a structural zero
    // (D1). Recorded explicitly rather than inferred by every future reader:
    // an unenforced ceiling that reads as a satisfied one is the exact failure
    // D1 exists to prevent. Absent pricing mode means unknown, so absent here
    // too, per D6 — never a default `true`.
    //
    // `api` pricing mode alone is NOT enough (F1, round-2 Critical): the guest
    // only receives a `max_usd` ceiling to enforce when `ceilings_for_payload`
    // (`dispatch.rs`) forwards one, which happens ONLY when this axis was
    // actually DECLARED (`resolved.max_usd_millis.declared.is_some()`) — an
    // undeclared axis still resolves to a concrete `.effective` default
    // (`ceilings_for_payload`'s own doc explains why), but nothing carries
    // that default to the guest to enforce. Recording `enforced: true` on
    // pricing mode alone was exactly the failure D1 invented this field to
    // prevent, inverted into the field itself: a plain `refarm ask` against an
    // api-mode provider recorded `enforced: true` with `bound_by.max_usd:
    // "default"` and nothing enforcing anything.
    if let Some(mode) = map.get("refarm.pricing_mode").and_then(|v| v.as_str()) {
        let declared_max_usd = input
            .resolved
            .is_some_and(|b| b.max_usd_millis.declared.is_some());
        let enforced = mode == "api" && declared_max_usd;
        map.insert("refarm.budget.max_usd.enforced".into(), enforced.into());
    }

    map.insert("timestamp_ns".into(), now_ns().into());
    serde_json::Value::Object(map)
}

/// Write a `BudgetObservation` node for one terminal effort. Called from
/// exactly one place, `dispatch::finalise_effort` (via `record_budget_observation`),
/// which is why the record cannot miss a `cancelled` or a `failed` — every
/// terminal status passes through that one call site.
///
/// D5: a failure ANYWHERE on this path — opening storage, finding the joined
/// usage, writing the row — must never escape into the run it observes. No `?`
/// that can escape this function, no `unwrap`, no panic: every fallible step
/// degrades to "skip the record" and logs at `warn`. The instrument may lose a
/// data point; it may not cost an operation.
///
/// `resolved`, `scenario` and `elapsed_ms` arrive as `Option` from the caller
/// (`record_budget_observation`): `resolved` is the dispatch-time fold taken
/// from `dispatch::dispatched_budgets()` (never re-resolved here — see that
/// function's doc), `None` only when no entry was found; `scenario` is the
/// dispatch-time resolution of WHICH WORK this was, taken from
/// `dispatch::dispatched_scenarios()` and likewise never re-derived here (the
/// tasks it derives from are not in hand at this point, and the declared id
/// never was); `elapsed_ms` is `None` only when the effort's timestamps failed
/// to parse. Any of those absences degrades gracefully via `put_opt`/the
/// `if let` in `build_observation_node` — the rest of the record is written
/// regardless (D6).
///
/// `results` is the terminal `EffortResult.results` the caller just stamped —
/// the ONLY thing on this path that carries what the run actually answered, and
/// therefore the only thing a declared expectation can be compared against. It
/// is passed rather than re-read because `finalise_effort` has it in hand and
/// the effort store's copy could already have moved on.
pub(crate) fn write_budget_observation(
    state: &SidecarState,
    effort_id: &str,
    resolved: Option<super::budget::ResolvedBudget>,
    scenario: Option<super::scenario::DispatchedScenario>,
    outcome: &str,
    elapsed_ms: Option<u64>,
    results: &[super::TaskResult],
) {
    // workspace_id / spawner / expectation ride the ORIGINAL Effort
    // (efforts_input), the same input `dispatch_effort` retained for retry. A
    // poisoned lock or an effort_id never retained (submitted before a restart)
    // all degrade to "unknown" — omitted on the node per D6 — never a panic.
    //
    // The expectation comes from HERE and not from a dispatch-time stash of its
    // own, deliberately. `dispatched_budgets` and `dispatched_scenarios` exist
    // because what they carry is DERIVED at dispatch and cannot be recovered
    // afterwards (a fold that must not be recomputed against a since-edited
    // config; a hash over tasks). An expectation is neither: it is a verbatim
    // caller declaration on the `Effort`, exactly like `workspace_id` two lines
    // up, which has always reached this record through this same read. A third
    // parallel store would be a third road to the same doorstep — and a store
    // whose entries are TAKEN would also have to be reasoned about across
    // retry, which this needs not be.
    let (workspace_id, workspace_source, spawner, expectation) = state
        .efforts_input
        .read()
        .ok()
        .and_then(|inputs| {
            inputs.get(effort_id).map(|effort| {
                (
                    effort.workspace_id.clone(),
                    effort.workspace_source.clone(),
                    effort.source.clone(),
                    super::verification::declared_expectation(effort.expectation.as_deref()),
                )
            })
        })
        .unwrap_or((None, None, None, None));

    // The comparison itself — run here, once, at the only point where both the
    // declaration and the answer exist. No expectation means no comparison and
    // no key on the node: "nobody checked" is the ordinary state and must never
    // be spelled `false`.
    let verification = expectation
        .as_deref()
        .map(|expected| super::verification::DeclaredVerification {
            expected,
            verdict: super::verification::verify(expected, results),
        });

    let prompt_ref = super::prompt_ref_from_effort(effort_id);
    // The RAW record, not `find_usage_for`'s device wire view — see
    // `find_usage_record_for`'s doc and `put_usage`'s doc for why (F4).
    let usage = super::dispatch::find_usage_record_for(&state.namespace, &prompt_ref);

    // WHO ran this — resolved live, every call, deliberately not cached on `state`:
    // `node_name` is a mutable declaration (a node can be renamed, and a rename must be
    // visible on the very next observation, not after a restart — the same "no caching"
    // doctrine `sidecar::budget::read_budget_section` already applies to `budget.node`).
    // `node_id` is resolved off `state.refarm_dir`, the exact directory
    // `node_descriptor::publish_for_this_process` published `node.json` into at boot — see
    // that field's doc on `SidecarState` for why this is not re-derived from env here.
    let node_base = crate::host::declared_base();
    let node_name = crate::node_identity::declared_node_name(&node_base);
    let node_id = crate::node_identity::load_or_create_node_id(&state.refarm_dir);

    // Both halves of the step fraction, taken as one read from one record.
    let (steps_completed, steps_planned) = steps_from_usage(usage.as_ref());

    let node = build_observation_node(ObservationInput {
        effort_id,
        prompt_ref: Some(&prompt_ref),
        workspace_id: workspace_id.as_deref(),
        workspace_source: workspace_source.as_deref(),
        spawner: spawner.as_deref(),
        outcome,
        elapsed_ms,
        node_name: node_name.as_deref(),
        node_id: node_id.as_deref(),
        // F1's other missing half, closed on BOTH halves: the joined
        // UsageRecord carries the step pair the completion loop counted
        // (`agent/src/provider_runtime/loop_progress.rs`), and it travels on
        // this effort's prompt_ref — the same join key this observation
        // already uses for every other usage field.
        //
        // The denominator was previously hardcoded `None` on the grounds that a
        // planned total exists only when the agent declared an `AgentPlan`
        // (`agent/src/plan.rs`), a node keyed by session_id rather than
        // prompt_ref. That was true of `AgentPlan` and irrelevant here: the "25"
        // of "4/25" was never a declared plan, it is the completion loop's own
        // iteration ceiling, and it was already travelling on prompt_ref in
        // every `agent:iteration` event this node renders as `step N/25`.
        steps_completed,
        steps_planned,
        // A DIFFERENT notion, kept under a name that says so — see
        // `UsageRecordPayload::turns_completed` in the agent crate. No ceiling
        // on turns exists anywhere, so this count is never half of a fraction.
        turns_completed: usage_count(usage.as_ref(), "turns_completed"),
        resolved,
        // Split here, at the record boundary, from the ONE `DispatchedScenario`
        // the caller took — the two halves live together in the stash precisely
        // so that "no resolution" cannot yield half a scenario.
        scenario_id: scenario.as_ref().and_then(|s| s.id.as_deref()),
        scenario_hash: scenario.as_ref().and_then(|s| s.hash.as_deref()),
        verification,
        usage,
    });

    let Some(id) = node.get("@id").and_then(|v| v.as_str()).map(str::to_string) else {
        tracing::warn!(
            effort_id,
            "sidecar: budget observation node built with no @id — dropping"
        );
        return;
    };

    let storage = match crate::storage::NativeStorage::open(&state.namespace) {
        Ok(storage) => storage,
        Err(error) => {
            tracing::warn!(
                effort_id,
                %error,
                "sidecar: failed to open storage for budget observation — dropping"
            );
            return;
        }
    };
    if let Err(error) = storage.store_node(&id, "BudgetObservation", None, &node.to_string(), Some("sidecar")) {
        tracing::warn!(effort_id, %error, "sidecar: failed to store budget observation");
    }
}
