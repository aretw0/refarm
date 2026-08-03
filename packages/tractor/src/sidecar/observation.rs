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

use super::SidecarState;

pub(crate) struct ObservationInput<'a> {
    pub effort_id: &'a str,
    pub prompt_ref: Option<&'a str>,
    pub workspace_id: Option<&'a str>,
    pub spawner: Option<&'a str>,
    pub outcome: &'a str,
    pub elapsed_ms: u64,
    pub steps_completed: Option<u32>,
    pub steps_planned: Option<u32>,
    pub resolved: super::budget::ResolvedBudget,
    /// The usage view from `find_usage_for`, already joined on prompt_ref.
    /// FLATTENED onto the node under OTel names — never nested (D2).
    pub usage: Option<serde_json::Value>,
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
    let b = &input.resolved;
    let mut map = serde_json::Map::new();
    map.insert("@type".into(), "BudgetObservation".into());
    map.insert("@id".into(), mint_observation_id().into());
    map.insert("effort_id".into(), input.effort_id.into());
    map.insert("refarm.outcome".into(), input.outcome.into());
    map.insert("refarm.elapsed_ms".into(), input.elapsed_ms.into());

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
    // The deadline is the axis that stops a run in practice, so its level is the
    // headline one. Per-axis levels ride beside it.
    map.insert("refarm.budget.bound_by".into(), axis_level_str(b.deadline_ms.bound_by).into());
    map.insert(
        "refarm.budget.bound_by.max_tokens".into(),
        axis_level_str(b.max_tokens.bound_by).into(),
    );
    map.insert(
        "refarm.budget.bound_by.max_usd".into(),
        axis_level_str(b.max_usd_millis.bound_by).into(),
    );

    // Field use has no scenario. The bench (spec slices 6-8) sets these.
    map.insert("refarm.scenario.id".into(), serde_json::Value::Null);
    map.insert("refarm.scenario.hash".into(), serde_json::Value::Null);

    put_opt(&mut map, "prompt_ref", input.prompt_ref.map(Into::into));
    put_opt(&mut map, "refarm.workspace.id", input.workspace_id.map(Into::into));
    put_opt(&mut map, "refarm.budget.spawner", input.spawner.map(Into::into));
    put_opt(&mut map, "refarm.outcome.steps_completed", input.steps_completed.map(Into::into));
    put_opt(&mut map, "refarm.outcome.steps_planned", input.steps_planned.map(Into::into));

    put_usage(&mut map, input.usage.as_ref());

    // A currency ceiling cannot bind where the estimate is a structural zero
    // (D1). Recorded explicitly rather than inferred by every future reader:
    // an unenforced ceiling that reads as a satisfied one is the exact failure
    // D1 exists to prevent. Absent pricing mode means unknown, so absent here
    // too, per D6 — never a default `true`.
    if let Some(mode) = map.get("refarm.pricing_mode").and_then(|v| v.as_str()) {
        let enforced = mode == "api";
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
pub(crate) fn write_budget_observation(
    state: &SidecarState,
    effort_id: &str,
    resolved: &super::budget::ResolvedBudget,
    outcome: &str,
    elapsed_ms: u64,
) {
    // workspace_id / spawner ride the ORIGINAL Effort (efforts_input), the same
    // input `dispatch_effort` retained for retry. A poisoned lock or an
    // effort_id never retained (submitted before a restart) both degrade to
    // "unknown" — omitted on the node per D6 — never a panic.
    let (workspace_id, spawner) = state
        .efforts_input
        .read()
        .ok()
        .and_then(|inputs| {
            inputs
                .get(effort_id)
                .map(|effort| (effort.workspace_id.clone(), effort.source.clone()))
        })
        .unwrap_or((None, None));

    let prompt_ref = super::prompt_ref_from_effort(effort_id);
    let usage = super::dispatch::find_usage_for(&state.namespace, &prompt_ref);

    let node = build_observation_node(ObservationInput {
        effort_id,
        prompt_ref: Some(&prompt_ref),
        workspace_id: workspace_id.as_deref(),
        spawner: spawner.as_deref(),
        outcome,
        elapsed_ms,
        // No plan/step tracking reaches the sidecar today — absent, not zero
        // (D6). A later caller with a real step count passes it through here.
        steps_completed: None,
        steps_planned: None,
        resolved: *resolved,
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
