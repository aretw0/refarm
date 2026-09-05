//! The sidecar's async effort execution engine: SidecarState-threaded
//! dispatch of respond (agent prompt) and non-respond (router event) efforts,
//! plus finalisation and time helpers. Extracted verbatim from mod.rs; the
//! model, persistence, and stream helpers stay in the parent and are imported.

use serde_json::Value;

use super::{
    persist_effort_result, prompt_ref_from_effort, record_effort_result, stream_ref_for_prompt,
    write_stream_chunk, Effort, EffortResult, EffortTask, SidecarState, TaskResult,
};

/// A human label for an effort's activity, shown by a surface as "working" text. Derived
/// from the effort's first task: a `respond` fn reads as "Agent responding"; any other
/// verb as "Running <plugin>::<verb>"; a task-less effort as a generic "Working". PURE.
fn effort_activity_label(effort: &Effort) -> String {
    match effort.tasks.first() {
        Some(task) => {
            let fn_name = task.fn_name.as_deref().unwrap_or("respond");
            if fn_name == "respond" {
                "Agent responding".to_string()
            } else if task.plugin_id.is_empty() {
                format!("Running {fn_name}")
            } else {
                format!("Running {}::{fn_name}", task.plugin_id)
            }
        }
        None => "Working".to_string(),
    }
}

/// The activity `kind` (open vocabulary) for an effort: `agent` for a respond turn (the
/// long model call the operator waits on), `dispatch` for any other verb dispatch. PURE.
fn effort_activity_kind(effort: &Effort) -> &'static str {
    match effort.tasks.first().and_then(|t| t.fn_name.as_deref()) {
        Some("respond") | None => "agent",
        Some(_) => "dispatch",
    }
}

/// Whether a terminal effort status is a SUCCESS (✓) vs a failure/timeout/cancel (✗) —
/// for the `ok` on `process:finished`. PURE.
fn effort_status_is_ok(status: &str) -> bool {
    matches!(status, super::EFFORT_DONE | super::EFFORT_DELIVERED | "partial")
}

/// Publish a `process:*` activity payload over BOTH transports at once — the telemetry
/// bus (in-process subscribers + the SSE/WS forwarders) and the append-only activity
/// file (the sovereign channel a separate-process surface tails without a live socket).
/// One payload, one call site per phase.
fn publish_activity(state: &SidecarState, event: &str, payload: serde_json::Value) {
    state
        .telemetry
        .emit(crate::telemetry::TelemetryEvent::new(event, None).with_payload(payload.clone()));
    let _ = super::write_activity_line(&state.streams_dir, &payload);
}

/// `process:started` for an effort — over both transports.
fn emit_effort_started(state: &SidecarState, effort: &Effort) {
    publish_activity(
        state,
        crate::telemetry::process_activity::EVENT_PROCESS_STARTED,
        crate::telemetry::process_activity::started_payload(
            &effort.id,
            &effort_activity_label(effort),
            effort_activity_kind(effort),
        ),
    );
}

/// `process:finished` for an effort — over both transports. `label` is empty (the surface
/// already has it from `started`, correlated by activityRef); `ok` reflects the terminal
/// status.
fn emit_effort_finished(state: &SidecarState, effort_id: &str, status: &str) {
    publish_activity(
        state,
        crate::telemetry::process_activity::EVENT_PROCESS_FINISHED,
        crate::telemetry::process_activity::finished_payload(
            effort_id,
            "",
            "dispatch",
            effort_status_is_ok(status),
        ),
    );
}

/// The agent's TERMINAL-RESULT contract, declared ONCE. A responding plugin stores
/// a node of `AGENT_RESPONSE_NODE_TYPE` carrying its `content`, keyed by
/// `AGENT_RESPONSE_CORRELATION_KEY` (the prompt it answers) and marked terminal by
/// `AGENT_RESPONSE_TERMINAL_FIELD`; the host watches for exactly that shape to
/// finalise the respond effort. These name the contract the host applies as the
/// DEFAULT for every responder today — the seam a per-plugin declared contract would
/// later populate — instead of the host re-stating `"Response"` as a bare literal
/// across the store, watcher, reader, and reaper.
pub const AGENT_RESPONSE_NODE_TYPE: &str = "Response";
pub const AGENT_RESPONSE_CORRELATION_KEY: &str = "prompt_ref";
pub const AGENT_RESPONSE_TERMINAL_FIELD: &str = "is_final";

#[derive(Debug)]
pub(crate) struct TaskArgs {
    pub(crate) prompt: String,
    pub(crate) system: Option<String>,
    pub(crate) session_id: Option<String>,
    pub(crate) history_turns: Option<u64>,
    pub(crate) provider: Option<String>,
    pub(crate) model: Option<String>,
    /// ADR-012 routing profile (cheap|balanced|reliable). Passed through verbatim to
    /// the responder's payload so the guest resolves the route by profile. The host
    /// does not interpret it — it is a neutral field forwarded like provider/model.
    pub(crate) profile: Option<String>,
    /// WHICH SEAT this dispatch spends, by opaque credential id (ISS-145).
    ///
    /// Sourced from the EFFORT rather than from the task's own args: the caller declares it once,
    /// beside the workspace it resolved it from, and the budget observation already stamps the same
    /// id. Forwarding it into the payload is what lets the host spend the account a workspace was
    /// bound to when its provider holds more than one seat — before this, one credential env var
    /// per provider made two seats of one provider mutually exclusive.
    pub(crate) credential_id: Option<String>,
    /// The endpoint the declared SEAT announces, when it announces one. Resolved by the host from
    /// its own credential map and forwarded so the guest and the guardrail agree.
    pub(crate) base_url: Option<String>,
    /// Which workspace the CALLER declared this run belongs to, and how it arrived at
    /// that. Forwarded verbatim, exactly like `profile`: the host never derives a
    /// workspace (it has no directory worth consulting on the caller's behalf), and the
    /// guest stamps it onto the Session node it creates so LATER turns in the same
    /// session inherit the attribution instead of re-seeding from whatever directory
    /// the operator happens to be standing in.
    pub(crate) workspace_id: Option<String>,
    pub(crate) workspace_source: Option<String>,
}

/// Describes the terminal RESULT node a dispatch awaits, so the watcher is
/// generic ("await a terminal correlated result") rather than agent-specific.
/// The LLM agent uses the default (an `AgentResponse` keyed by `prompt_ref`,
/// terminal when `is_final` is true), but ANY plugin that writes a node of its
/// own `node_type` carrying the same shape can be awaited the same way — the same
/// move EventRouter made for events. Nothing here is LLM-intrinsic; the write
/// path (store_node bridge, loro→sqlite projection, query_nodes) is already
/// type-agnostic.
#[derive(Debug, Clone)]
pub(crate) struct TerminalResultSpec {
    /// JSON-LD `@type` of the result node to query for.
    pub(crate) node_type: String,
    /// Field name carrying the correlation id (e.g. `prompt_ref`).
    pub(crate) correlation_key: String,
    /// The correlation value to match forward.
    pub(crate) correlation_value: String,
    /// Bool field that marks a node terminal (e.g. `is_final`).
    pub(crate) terminal_flag_field: String,
}

impl TerminalResultSpec {
    /// The agent respond default: an `AgentResponse` correlated by `prompt_ref`,
    /// terminal when `is_final` — so the LLM path is byte-for-byte unchanged.
    pub(crate) fn agent_response(prompt_ref: impl Into<String>) -> Self {
        Self {
            node_type: AGENT_RESPONSE_NODE_TYPE.to_string(),
            correlation_key: AGENT_RESPONSE_CORRELATION_KEY.to_string(),
            correlation_value: prompt_ref.into(),
            terminal_flag_field: AGENT_RESPONSE_TERMINAL_FIELD.to_string(),
        }
    }
}

/// The terminal result a watcher found: its `content`, and whether the node
/// declared itself an error (`is_error: true`) so the watcher finalises `failed`
/// instead of `done`. A plugin (or the host, on a guest failure — finding #4)
/// can write a terminal ERROR node the same generic way it writes a success node.
#[derive(Debug)]
pub(crate) struct TerminalResult {
    pub(crate) content: String,
    pub(crate) is_error: bool,
}

pub(crate) fn extract_task_args(task: &EffortTask) -> Result<TaskArgs, String> {
    let args = &task.args;
    let prompt = args
        .get("prompt")
        .and_then(|v| v.as_str())
        .or_else(|| args.get("query").and_then(|v| v.as_str()))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "sidecar: @refarm/agent::respond requires args.prompt".to_string())?
        .to_string();

    Ok(TaskArgs {
        prompt,
        system: args
            .get("system")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        session_id: args
            .get("session_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string()),
        history_turns: args.get("history_turns").and_then(|v| v.as_u64()),
        provider: args
            .get("provider")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string()),
        model: args
            .get("model")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string()),
        // Filled from the EFFORT after this parse — a task's own args do not carry it.
        credential_id: None,
        base_url: None,
        profile: args
            .get("profile")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string()),
        workspace_id: args
            .get("workspace_id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string()),
        workspace_source: args
            .get("workspace_source")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string()),
    })
}

/// The `user:prompt` payload handed to the responder for a `respond` effort.
///
/// PURE over already-extracted args + the resolved ceilings — extracted for the same
/// reason `ceilings_for_payload` was: every field the guest can only learn from this
/// payload is now assertable without standing up the async dispatch/channel/SidecarState
/// machinery. A field silently dropped here is invisible to the guest and to every
/// unit test that stops at `extract_task_args`, which is exactly how `workspace_id`
/// reached the sidecar and never reached the Session node.
///
/// Absent-not-null throughout: a key the caller did not declare carries no key at all.
fn respond_payload_json(
    args: &TaskArgs,
    prompt_ref: &str,
    declared_max_tokens: Option<u64>,
    declared_max_usd: Option<f64>,
) -> Value {
    let mut payload_obj = serde_json::json!({
        "prompt": args.prompt,
        "prompt_ref": prompt_ref,
    });
    fn put_str(target: &mut Value, key: &str, value: Option<&String>) {
        if let Some(v) = value {
            target[key] = Value::String(v.clone());
        }
    }
    put_str(&mut payload_obj, "system", args.system.as_ref());
    put_str(&mut payload_obj, "session_id", args.session_id.as_ref());
    if let Some(turns) = args.history_turns {
        payload_obj["history_turns"] = Value::Number(turns.into());
    }
    put_str(&mut payload_obj, "provider", args.provider.as_ref());
    put_str(&mut payload_obj, "model", args.model.as_ref());
    put_str(&mut payload_obj, "profile", args.profile.as_ref());
    // Rides the same channel as `profile` and `workspace_id` — no second road for one more value.
    // The HOST reads it (to pick the seat's credential); the guest ignores it.
    put_str(&mut payload_obj, "credential_id", args.credential_id.as_ref());
    // THE SEAT'S ENDPOINT, so the guest builds the request the host will admit (ISS-145).
    //
    // Two seats of one provider can announce different hosts, and the per-PROVIDER map cannot hold
    // both — measured: with both Copilot seats authorised the guest fell back to its static default
    // and the guardrail refused it for a base url the node genuinely authorised, under the other
    // seat. The endpoint is not secret; only the token beside it is, and that stays in the host.
    put_str(&mut payload_obj, "base_url", args.base_url.as_ref());
    // The declared workspace rides the same channel as `profile` — no second road for
    // one more value. The guest reads it only where it CREATES a Session node, so a
    // dispatch carrying a workspace can never re-attribute a conversation already
    // under way.
    put_str(&mut payload_obj, "workspace_id", args.workspace_id.as_ref());
    put_str(
        &mut payload_obj,
        "workspace_source",
        args.workspace_source.as_ref(),
    );
    // Task 12: the resolved token/spend ceilings, beside the values above —
    // absent (no key) when nothing declared either axis, per the gate computed
    // by `ceilings_for_payload`.
    if let Some(max_tokens) = declared_max_tokens {
        payload_obj["max_tokens"] = Value::Number(max_tokens.into());
    }
    if let Some(max_usd) = declared_max_usd {
        if let Some(num) = serde_json::Number::from_f64(max_usd) {
            payload_obj["max_usd"] = Value::Number(num);
        }
    }
    payload_obj
}

// ── effort dispatch ──────────────────────────────────────────────────────────

/// Dispatch a non-`respond` effort as a generic ROUTER event. The task names a
/// `plugin_id` and a `fn` (the verb); the plugin receives the event
/// `<pluginKey>:dispatch` carrying `{verb, ...args}`, by its
/// `capabilities.subscribes` declaration, and returns its result asynchronously
/// through store-node (dispatch-result:v1). The effort is finalised the moment the
/// event is delivered (or fails to deliver) — HONESTLY: `done` only when a
/// subscriber actually received it, `failed` when it was undeliverable, never the
/// optimistic `done result:None` for an unrouted event.
pub(crate) fn dispatch_event_effort(
    state: &SidecarState,
    effort_id: &str,
    task: &crate::sidecar::EffortTask,
    fn_name: &str,
) {
    // The event name a plugin subscribes to: `<pluginKey>:dispatch`. `plugin_id`
    // is the task's target (e.g. `vault`), so `vault` -> `vault:dispatch`.
    let plugin_key = task.plugin_id.rsplit('/').next().unwrap_or(&task.plugin_id);
    let event = format!("{plugin_key}:dispatch");

    // Resolve the DELIVERY TARGET (the runner channel key) from the verb NAMESPACE.
    // A plugin subscribes to `<key>:dispatch` but its channel is keyed by its RUNTIME
    // ID — and the two differ when a manifest declares an explicit `verbs.key` (e.g.
    // lsp-code-ops's id is `lsp-code-ops` but its key is `code-ops`). The agent invoke
    // path keeps these separate (capability_tools: event from key, target from id); the
    // effort path only carries one `plugin_id`, so resolve the runtime id here via the
    // registry's dispatchable verbs (which carry both). Falls back to the incoming id
    // when there is no registry or no match — preserving behaviour for the common case
    // where key == id (e.g. `vault`, `delegate`).
    let target_id = state
        .plugin_registry
        .as_ref()
        .and_then(|reg| {
            reg.dispatchable_verbs()
                .into_iter()
                .find(|v| v.plugin_key == plugin_key)
                .map(|v| v.plugin_id)
        })
        .unwrap_or_else(|| task.plugin_id.clone());

    // The payload carries the verb (the effort's fn) plus the task args, so the
    // plugin's on-event handler knows which verb to run.
    let mut payload_obj = serde_json::json!({ "verb": fn_name });
    if !task.args.is_null() {
        if let Some(map) = task.args.as_object() {
            for (k, v) in map {
                payload_obj[k] = v.clone();
            }
        } else {
            payload_obj["args"] = task.args.clone();
        }
    }
    let payload = payload_obj.to_string();

    let sent = crate::deliver_via_router(
        &state.event_router,
        &state.plugin_channels,
        &state.telemetry,
        &event,
        Some(&target_id),
        Some(payload),
    );

    if sent > 0 {
        tracing::info!(effort_id = %effort_id, %event, plugin_id = %task.plugin_id, "dispatched event effort via router");
        // `delivered`, not `done`: delivery is the effort's whole job here. The
        // verb result lands asynchronously as a dispatch-result:v1 node the caller
        // reads back by replyRef; the effort records that the event was delivered,
        // not the node (which the graph owns). Marking `done` would lie — `done`
        // asserts the effort itself carries a completed task result.
        finalise_effort(
            state,
            effort_id,
            super::EFFORT_DELIVERED,
            vec![TaskResult {
                status: "ok".to_string(),
                result: Some(serde_json::json!({ "dispatched": event, "sent": sent })),
                error: None,
            }],
        );
    } else {
        finalise_effort(
            state,
            effort_id,
            "failed",
            vec![TaskResult {
                status: "error".to_string(),
                result: None,
                error: Some(format!(
                    "no plugin subscribed to '{event}' (is '{}' loaded and does its manifest declare subscribes:[{event}]?)",
                    task.plugin_id
                )),
            }],
        );
    }
}

/// The `ResolvedBudget` `dispatch_effort` computes exactly once, keyed by
/// effort_id, for `record_budget_observation` to read back verbatim at
/// finalisation — the dispatch→finalisation hand-off `SidecarState.efforts_input`
/// performs for the `Effort` itself, but private to this module rather than a
/// `SidecarState` field: Task 10's protected-surface authorisation permits
/// touching `sidecar/mod.rs` only to add the single `mod observation;` line, and
/// a widened `SidecarState` (new field + constructor plumbing) would exceed
/// that. This value's whole life is dispatch→finalisation and needs no
/// visibility outside `dispatch.rs`, so a module-private store is not a
/// workaround — it is the right shape for something nothing else should touch.
///
/// Read fresh vs. read back is a real distinction, not a style choice: the fold
/// (`node_budget_from_config` / `workspace_budget_for`) re-reads
/// `.refarm/config.json` from disk on every call, which is correct when code is
/// DECIDING what policy applies now (dispatch time). It is wrong when code is
/// RECORDING what governed a decision already made (finalisation time) — that
/// decision happened once, here, and rode literally into
/// `spawn_terminal_result_watcher`'s `deadline_ms`, the same number that decides
/// `timed-out`. Recomputing at finalisation answers "what would policy say now",
/// which can diverge from "what did policy say then" if a config edit lands
/// mid-run — exactly the scenario D4 exists to enable (an operator raising a
/// ceiling because the evidence shows it binding constantly).
///
/// Taken (removed on read), not merely read: a terminal effort's resolved
/// budget is consumed exactly once, by `record_budget_observation`, so removal
/// there IS its cleanup — no second reap lifetime to invent alongside
/// `efforts_input`'s 24h TTL. A retry re-dispatches through `dispatch_effort`,
/// which repopulates the entry before the retry's own finalisation reads it.
fn dispatched_budgets() -> &'static std::sync::RwLock<std::collections::HashMap<String, super::budget::ResolvedBudget>>
{
    static STORE: std::sync::OnceLock<
        std::sync::RwLock<std::collections::HashMap<String, super::budget::ResolvedBudget>>,
    > = std::sync::OnceLock::new();
    STORE.get_or_init(|| std::sync::RwLock::new(std::collections::HashMap::new()))
}

/// WHICH WORK each in-flight effort is, keyed by effort id, for
/// `record_budget_observation` to read back at finalisation. The same
/// dispatch→finalisation hand-off `dispatched_budgets` above performs, with the
/// same lifetime, the same single consumer, and the same "removal there IS its
/// cleanup" rule — read that function's doc first; this is that pattern applied,
/// not a second one invented.
///
/// Re-deriving at finalisation is not merely wasteful here, it is impossible:
/// `Effort.tasks` survives only in `SidecarState.efforts_input` (in-process,
/// reaped at 24h) and the DECLARED id has no other home at all. So absence is
/// honest and permanent, exactly as it is for the budget — an effort finalised
/// by a process that did not dispatch it (a restart mid-run) records no
/// scenario, the same way it records no budget family.
///
/// Stashed for EVERY effort, not only the `agent` ones the budget stash gates
/// on: a budget governs only a `respond`, but "which work was this" is a
/// property of the REQUEST, and a router-dispatched `vault:extract` is work
/// whose repeats are just as comparable as an agent turn's.
fn dispatched_scenarios(
) -> &'static std::sync::RwLock<std::collections::HashMap<String, super::scenario::DispatchedScenario>>
{
    static STORE: std::sync::OnceLock<
        std::sync::RwLock<std::collections::HashMap<String, super::scenario::DispatchedScenario>>,
    > = std::sync::OnceLock::new();
    STORE.get_or_init(|| std::sync::RwLock::new(std::collections::HashMap::new()))
}

/// Every dispatch-time resolved `deadline_ms`, keyed by effort id — a SNAPSHOT.
/// Reads without taking: `record_budget_observation` is still the one and only
/// consumer entitled to remove an entry, and a reader that removed one would
/// destroy the observation it was trying to describe.
///
/// An effort absent from this map has no knowable deadline, which is a real and
/// permanent state, not a transient one: an event-dispatch effort never stashes a
/// resolution (nothing governs it — see `dispatch_effort`), and an effort loaded
/// back from `task-results/` after a previous process died left its resolution in
/// that process's memory. Callers must treat absence as "could not tell", never
/// as a zero or a default.
pub(crate) fn dispatched_deadlines_ms() -> std::collections::HashMap<String, u64> {
    match dispatched_budgets().read() {
        Ok(store) => store
            .iter()
            .map(|(effort_id, budget)| (effort_id.clone(), budget.deadline_ms.effective))
            .collect(),
        Err(_) => {
            tracing::warn!(
                "sidecar: the dispatch-time budget store could not be read — no deadline is knowable for any in-flight effort"
            );
            std::collections::HashMap::new()
        }
    }
}

/// Task 12: the (max_tokens, max_usd) pair to fold into the per-effort payload
/// the agent reads its ceilings from — `None` for either axis the fold's own
/// DECLARATION never touched (`ResolvedAxis::declared`), not the axis whose
/// `effective` value is merely the node's structural default. `effective` is
/// ALWAYS some concrete number (100_000 tokens / $1 today, even when nothing
/// anywhere declared a thing), so gating on it instead of `declared` would hand
/// every nothing-declared installation a live ceiling out of nowhere — the
/// exact "zero ceiling" failure mode ruled out for an absent declaration.
/// `max_usd` converts back from the fold's integer thousandths-of-a-dollar to
/// the decimal dollars the wire (and MODEL_RUN_MAX_USD) uses.
///
/// PURE over an already-resolved `ResolvedBudget` — extracted so this rule is
/// unit-testable without standing up the full async dispatch/channel/
/// SidecarState machinery `dispatch_effort` itself requires.
fn ceilings_for_payload(resolved: &super::budget::ResolvedBudget) -> (Option<u64>, Option<f64>) {
    let max_tokens = resolved.max_tokens.declared.map(|_| resolved.max_tokens.effective);
    let max_usd = resolved
        .max_usd_millis
        .declared
        .map(|_| resolved.max_usd_millis.effective as f64 / 1000.0);
    (max_tokens, max_usd)
}

pub(crate) fn dispatch_effort(state: SidecarState, effort: Effort) {
    // Retain the original Effort (tasks/args) so retry can re-dispatch it — the
    // efforts result store keeps only EffortResult, which has no tasks. In-process
    // only; not persisted.
    state
        .efforts_input
        .write()
        .expect("efforts_input poisoned")
        .insert(effort.id.clone(), effort.clone());

    // Resolve the effort's budget ONCE, up front — the same declared/workspace/node fold
    // budget-contract-v1 proves in TS, ported to integer arithmetic. The workspace ceiling
    // and the node's own config-declared override both read the sovereign config, keyed by
    // `node_base` — `declared_base()`, the SAME "declared, not detected" base every other
    // subsystem in this crate resolves its declarations against (`sidecar::remote_initiation`
    // is the precedent for a sidecar file reaching for it), never `current_dir()` here. An
    // effort with no declared budget, on a node with no `budget` section in its config,
    // resolves entirely from the node's env-backed defaults, so every existing installation
    // behaves exactly as it does today. The node deadline default is threaded from
    // `state.respond_watch.timeout_ms` (already resolved from env ONCE at boot) rather than
    // re-read from env here — see `NodeBudget::from_respond_watch` for why that's the one
    // that must be used; `node_budget_from_config` then layers any `budget.node` declaration
    // over it, config winning where present.
    let node_base = crate::host::declared_base();
    let node_budget = super::budget::node_budget_from_config(
        &node_base,
        super::budget::NodeBudget::from_respond_watch(state.respond_watch.timeout_ms),
    );
    // The PAIR, never the id alone: a workspace ceiling is policy the operator set, and a cwd
    // seed selecting it is the sidecar deciding a spending limit from a `cd` (ISS-058).
    let workspace_budget = super::budget::workspace_budget_for(
        &node_base,
        effort.workspace_id.as_deref(),
        effort.workspace_source.as_deref(),
    );
    let resolved_budget =
        super::budget::resolve_budget(effort.budget.as_ref(), workspace_budget.as_ref(), &node_budget);
    let deadline_ms = resolved_budget.deadline_ms.effective;

    // Task 12: the two other axes, carried into the per-effort payload below
    // (the same channel `provider`/`model`/`profile` already ride — no second
    // road for one more value). See `ceilings_for_payload`'s doc for the gate.
    let (declared_max_tokens, declared_max_usd) = ceilings_for_payload(&resolved_budget);

    // Only a `respond` effort is ever GOVERNED by this resolution: it is the
    // only path that spawns the deadline watcher (`spawn_terminal_result_watcher`,
    // below) or forwards `declared_max_tokens`/`declared_max_usd` to the guest.
    // An event-dispatch effort (`effort_activity_kind` == "dispatch", routed to
    // `dispatch_event_effort`) never sees this value or the watcher at all — it
    // resolves synchronously to `EFFORT_DELIVERED`/`failed`, nothing enforces
    // any axis, and no `UsageRecord` exists to join. Stashing the resolution
    // anyway used to let `record_budget_observation` read it back at
    // finalisation and fabricate a full `refarm.budget.*` family on an effort
    // no budget ever governed (F2, round-2 Critical) — the whole family rides
    // together (see the module doc), so recording it here was recording a lie
    // three axes wide, not one field wrong.
    //
    // Determined synchronously here, not inside the spawned task: `effort.tasks`
    // needs no `.await` to read, and the stash must happen before finalisation
    // can possibly race it — the same reason the fold itself resolves up front.
    if effort_activity_kind(&effort) == "agent" {
        // Stash the SAME fold `deadline_ms` above was just read from, so
        // `record_budget_observation` reads back exactly what governed this run
        // instead of re-resolving it against whatever `.refarm/config.json` says by
        // the time the effort finalises. See `dispatched_budgets`'s doc for why
        // that distinction is load-bearing, not stylistic.
        if let Ok(mut store) = dispatched_budgets().write() {
            store.insert(effort.id.clone(), resolved_budget);
        }
    }

    // WHICH WORK this is — the declared scenario id the caller carried, and the
    // hash derived from the request shape that exists HERE and nowhere at
    // finalisation. Ungated by activity kind (see `dispatched_scenarios`'s doc):
    // unlike a budget, a scenario describes the request, and every effort has
    // one. Resolved synchronously, before the spawn below, for the same reason
    // the budget fold is — finalisation could otherwise race the stash.
    if let Ok(mut store) = dispatched_scenarios().write() {
        store.insert(
            effort.id.clone(),
            super::scenario::DispatchedScenario {
                id: super::scenario::declared_scenario_id(effort.scenario_id.as_deref()),
                hash: super::scenario::scenario_hash(&effort.tasks),
            },
        );
    }

    tokio::spawn(async move {
        let effort_id = effort.id.clone();
        let submitted_at = effort.submitted_at.clone();

        // Mark in-progress — our own dispatch work is now running. (Was the
        // non-contract literal "active"; see EFFORT_IN_PROGRESS.) Non-terminal,
        // so completed_at stays None.
        record_effort_result(
            &state,
            EffortResult {
                effort_id: effort_id.clone(),
                status: super::EFFORT_IN_PROGRESS.to_string(),
                results: vec![],
                submitted_at: submitted_at.clone(),
                completed_at: None,
            },
        );

        // Emit the surface-neutral "working" signal: this effort's work is now running.
        // A daemon→surface bridge forwards it so the operator sees an agent turn / a
        // dispatch in flight instead of a frozen surface. The effort id is the
        // activityRef; `process:finished` fires from finalise_effort on the terminal state.
        // Two transports, one payload: the telemetry bus (in-process subscribers + the
        // SSE/WS forwarders) AND an append to activity.ndjson (the sovereign file a
        // separate-process CLI/TUI tails without a live socket).
        emit_effort_started(&state, &effort);

        let task = match effort.tasks.first() {
            Some(t) => t.clone(),
            None => {
                finalise_effort(
                    &state,
                    &effort_id,
                    "failed",
                    vec![TaskResult {
                        status: "error".to_string(),
                        result: None,
                        error: Some("effort has no tasks".to_string()),
                    }],
                );
                return;
            }
        };

        let fn_name = task.fn_name.as_deref().unwrap_or("respond").to_string();

        // Two entries, one dispatcher. `respond` is the agent's prompt flow (below,
        // streamed to the client). Any OTHER fn is a generic EVENT dispatch: the
        // task's `<pluginId>:dispatch` event is routed to that plugin via the
        // neutral router (it must subscribe to the event), and the plugin returns
        // its result asynchronously through store-node (the dispatch-result:v1
        // contract), not the prompt stream. This is what lets an operator dispatch
        // a non-agent plugin's verb (e.g. `vault extract`) from outside.
        if fn_name != "respond" {
            dispatch_event_effort(&state, &effort_id, &task, &fn_name);
            return;
        }

        let mut args = match extract_task_args(&task) {
            Ok(args) => args,
            Err(error) => {
                finalise_effort(
                    &state,
                    &effort_id,
                    "failed",
                    vec![TaskResult {
                        status: "error".to_string(),
                        result: None,
                        error: Some(error),
                    }],
                );
                return;
            }
        };
        // FROM THE EFFORT, not from the task's args (ISS-145). The caller declares which seat it
        // spends once, beside the workspace it resolved that from, and the budget observation
        // stamps the same id — so the seat that was bound, the seat that pays and the seat the
        // record names are ONE id rather than three inferences that can disagree.
        args.credential_id = effort
            .credential_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        // Read from the host's OWN credential map — the endpoint half of it, never the token.
        args.base_url = args
            .credential_id
            .as_deref()
            .and_then(crate::host::wasi_bridge::account_base_url_from_env);
        let prompt_ref = prompt_ref_from_effort(&effort_id);
        let stream_ref = stream_ref_for_prompt(&prompt_ref);
        tracing::info!(
            effort_id = %effort_id,
            source = effort.source.as_deref().unwrap_or(""),
            provider = args.provider.as_deref().unwrap_or(""),
            model = args.model.as_deref().unwrap_or(""),
            "dispatching sidecar effort to active agent"
        );

        // Build the structured payload for agent's handle_prompt.
        // Includes all session context so agent maintains conversation history.
        // PURE and unit-tested — see `respond_payload_json`.
        let payload =
            respond_payload_json(&args, &prompt_ref, declared_max_tokens, declared_max_usd)
                .to_string();

        // Dispatch to the active agent channel.
        // Prefer the plugin registered via the "integration:respond" capability.
        // Fall back to the task's plugin_id for backward compatibility
        // (e.g. when loaded without a manifest in dev mode).
        let agent_id = state
            .default_responder_id
            .read()
            .expect("default_responder_id poisoned")
            .clone()
            .unwrap_or_else(|| task.plugin_id.clone());

        let sent = {
            let channels = state.plugin_channels.read().expect("channels poisoned");
            channels.get(&agent_id).map(|tx| {
                tx.send(crate::EventEnvelope::fire(
                    "user:prompt".to_string(),
                    Some(payload),
                ))
            })
        };

        match sent {
            None => {
                // Plugin not loaded — write error stream chunk so client doesn't timeout.
                let _ = write_stream_chunk(
                    &state.streams_dir,
                    &stream_ref,
                    0,
                    &format!("[agent not loaded ({agent_id}) - run refarm plugin status, then refarm plugin install or reload]"),
                    true,
                    None,
                );
                finalise_effort(
                    &state,
                    &effort_id,
                    "failed",
                    vec![TaskResult {
                        status: "error".to_string(),
                        result: None,
                        error: Some(format!("{agent_id} not loaded")),
                    }],
                );
            }
            Some(Err(e)) => {
                let _ = write_stream_chunk(
                    &state.streams_dir,
                    &stream_ref,
                    0,
                    &format!("[dispatch error: {e}]"),
                    true,
                    None,
                );
                finalise_effort(
                    &state,
                    &effort_id,
                    "failed",
                    vec![TaskResult {
                        status: "error".to_string(),
                        result: None,
                        error: Some(format!("channel send error: {e}")),
                    }],
                );
            }
            Some(Ok(())) => {
                // The prompt was handed to the plugin runner thread, which produces
                // the answer asynchronously as `AgentResponse` CRDT nodes stamped
                // with this prompt_ref. The effort is NOT done on send — it stays
                // `in-progress` (recorded at dispatch start). Spawn a bounded watcher
                // that finalises the effort to `done` when the terminal (is_final)
                // AgentResponse node lands, or to `timed-out` if the agent stays
                // silent past the deadline. This closes the honest state machine:
                // the effort transitions in-progress -> done on the REAL result, not
                // a fake done on send.
                tracing::debug!(
                    effort_id = %effort_id,
                    "respond prompt handed to runner; watching for terminal AgentResponse"
                );
                // The agent's respond awaits the default terminal-result spec
                // (AgentResponse / prompt_ref / is_final) — the LLM path is
                // unchanged; the watcher itself is now generic.
                spawn_terminal_result_watcher(
                    state.clone(),
                    effort_id.clone(),
                    TerminalResultSpec::agent_response(prompt_ref.clone()),
                    deadline_ms,
                );
            }
        }
    });
}

pub(crate) fn finalise_effort(
    state: &SidecarState,
    effort_id: &str,
    status: &str,
    results: Vec<TaskResult>,
) {
    let result = {
        let mut s = state.efforts.write().expect("effort store poisoned");
        s.get_mut(effort_id).map(|entry| {
            entry.status = status.to_string();
            entry.results = results;
            // completed_at is stamped exactly once, here, when and only when the
            // status is terminal. A non-terminal transition (e.g. in-progress)
            // must never carry a completion timestamp — a stamped completed_at is
            // the signal a watch loop trusts to stop.
            entry.completed_at = if super::is_terminal_effort_status(status) {
                Some(chrono_now_iso())
            } else {
                None
            };
            entry.clone()
        })
    };
    if let Some(result) = result {
        // The work reached a terminal state — tell the surfaces to stop the "working"
        // affordance for this effort. `ok` is whether the terminal status is a success
        // (done) vs a failure/timeout, so a surface can show ✓ vs ✗.
        if super::is_terminal_effort_status(status) {
            emit_effort_finished(state, effort_id, status);
            // Every terminal path — done, failed, timed-out, cancelled — passes
            // through this one call site, which is why it is the single place
            // Task 10's BudgetObservation record is written from. Best-effort:
            // see `record_budget_observation`'s doc for the guarantee it upholds.
            record_budget_observation(state, effort_id, status, &result);
        }
        if let Err(error) = persist_effort_result(&state.results_dir, &result) {
            tracing::warn!(
                effort_id = %result.effort_id,
                %error,
                "sidecar: failed to persist final effort result"
            );
        }
    }
}

/// Read back the budget `dispatch_effort` resolved for this effort, with its
/// elapsed time, and hand both to `observation::write_budget_observation` —
/// the call that actually builds and stores the `BudgetObservation` node. See
/// that function's doc for the D5 guarantee this whole path upholds: a lost
/// observation must never touch the run it observed.
///
/// The resolved budget is TAKEN from `dispatched_budgets()`, never
/// re-resolved: see that function's doc for why recomputing the fold here
/// would answer "what would policy say now" instead of "what did policy say
/// then". If the entry is missing — a restart mid-run, or (in principle) a
/// process that outlives this in-memory store some other way — the budget
/// fields are OMITTED from the observation rather than reconstructed by
/// re-resolving: D6 governs (absent is honest, fabricated is not), and a
/// "resolve it again" fallback would silently reintroduce the exact defect
/// this function exists to close.
///
/// Elapsed time is derived from `EffortResult.submitted_at` / `completed_at`
/// (both already stamped by the caller) rather than threading new state, per
/// the controller's resolution #5. A parse failure there costs only the
/// `elapsed_ms` field (via `put_opt` inside `build_observation_node`) — not
/// the outcome, the budget, or the workspace, which is why this function no
/// longer returns early on it.
///
/// Both ends parse through `iso_to_epoch_millis`, and BOTH must carry
/// millisecond precision or the subtraction is a lie in a field named `_ms`.
/// `submitted_at` always did (every client stamps it with
/// `new Date().toISOString()`); `completed_at` did not until `chrono_now_iso`
/// was moved to `now_iso_millis`. Mixing the two resolutions is worse than
/// having neither: a start of `…:00.900Z` against a second-truncated end of
/// `…:01Z` measures 100ms for an effort that took over a second, and any
/// effort finishing inside the second it started measured zero.
fn record_budget_observation(
    state: &SidecarState,
    effort_id: &str,
    status: &str,
    result: &EffortResult,
) {
    let elapsed_ms = match (
        crate::timefmt::iso_to_epoch_millis(&result.submitted_at),
        result
            .completed_at
            .as_deref()
            .and_then(crate::timefmt::iso_to_epoch_millis),
    ) {
        (Some(start), Some(end)) => Some(end.saturating_sub(start)),
        _ => {
            tracing::warn!(
                effort_id,
                "sidecar: could not derive elapsed_ms for budget observation — recording without it"
            );
            None
        }
    };

    let resolved = dispatched_budgets()
        .write()
        .ok()
        .and_then(|mut store| store.remove(effort_id));
    if resolved.is_none() {
        tracing::warn!(
            effort_id,
            "sidecar: no dispatch-time budget resolution found for this effort — recording without budget fields"
        );
    }

    // WHICH WORK this was — taken (not merely read) the same way the budget is,
    // and for the same reason: one terminal effort, one consumer, so removal
    // here is the whole of its cleanup. No `warn` on absence, unlike the budget
    // above: an effort that declared no scenario and carried no hashable request
    // is an ordinary, expected state of field use, not a signal that something
    // went wrong. Both halves ride together — a missing entry omits both fields
    // rather than reconstructing either (D6).
    let scenario = dispatched_scenarios()
        .write()
        .ok()
        .and_then(|mut store| store.remove(effort_id));

    // `result.results` rides along because it is the only thing here that
    // carries what the run ANSWERED — what a declared `Effort.expectation` gets
    // compared against, so the record can say the run was wrong without touching
    // `status`, which keeps meaning exactly what it always did.
    super::observation::write_budget_observation(
        state,
        effort_id,
        resolved,
        scenario,
        status,
        elapsed_ms,
        &result.results,
    );
}

/// Finalise an effort ONLY if it has not already reached a terminal state.
/// Returns true if it transitioned. Used by the respond watcher so a late result
/// landing never overwrites a terminal state a concurrent path already set (e.g.
/// a cancel that marked `cancelled`, or an error path that marked `failed`).
/// Terminal states are final — the machine does not walk backward out of them.
pub(crate) fn finalise_effort_if_active(
    state: &SidecarState,
    effort_id: &str,
    status: &str,
    results: Vec<TaskResult>,
) -> bool {
    {
        let s = state.efforts.read().expect("effort store poisoned");
        match s.get(effort_id) {
            Some(entry) if super::is_terminal_effort_status(&entry.status) => return false,
            None => return false,
            _ => {}
        }
    }
    finalise_effort(state, effort_id, status, results);
    true
}

/// How long the respond watcher waits for the agent's terminal AgentResponse
/// node before finalising the effort as `timed-out`. Overridable for tests /
/// tuning via REFARM_RESPOND_WATCH_TIMEOUT_MS; defaults to 45s to mirror the TS
/// stream-follow timeout (REFARM_STREAM_FOLLOW_TIMEOUT_MS).
/// Parse REFARM_RESPOND_WATCH_TIMEOUT_MS from env. Called ONCE at boot via
/// RespondWatchConfig::from_env; the watcher reads the resolved value off the
/// SidecarState, not env.
pub(crate) fn respond_watch_timeout_ms_from_env() -> u64 {
    std::env::var("REFARM_RESPOND_WATCH_TIMEOUT_MS")
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|ms| *ms > 0)
        .unwrap_or(45_000)
}

/// Poll interval for the respond watcher's storage reads. Matches the TS stream
/// follow cadence (100ms). Parsed ONCE at boot via RespondWatchConfig::from_env.
pub(crate) fn respond_watch_interval_ms_from_env() -> u64 {
    std::env::var("REFARM_RESPOND_WATCH_INTERVAL_MS")
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|ms| *ms > 0)
        .unwrap_or(100)
}

/// The terminal AgentResponse node for a respond effort, if present. Reads the
/// CRDT `AgentResponse` nodes for `namespace`, keeps only rows carrying our
/// `prompt_ref`, and returns the content of the first `is_final` one. Mirrors the
/// correlation the whole stack agrees on: the agent stamps `prompt_ref` onto
/// every AgentResponse node (model_stream_events.rs), derived from this effort_id.
/// Find the terminal correlated result node described by `spec`, if present.
/// Reads the CRDT read model for nodes of `spec.node_type`, keeps only rows
/// whose `spec.correlation_key` equals `spec.correlation_value`, and returns the
/// first one whose `spec.terminal_flag_field` is true. Generic: the agent's
/// `AgentResponse`/`prompt_ref`/`is_final` is just the default spec — any plugin
/// writing a same-shaped node is found identically. An `is_error: true` field on
/// the node marks a terminal ERROR result (so a guest failure surfaces as
/// `failed`, not a 45s `timed-out`).
pub(crate) fn find_terminal_result(
    namespace: &str,
    spec: &TerminalResultSpec,
) -> Option<TerminalResult> {
    let storage = crate::storage::NativeStorage::open(namespace).ok()?;
    let rows = storage.query_nodes(&spec.node_type).ok()?;
    for row in rows {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&row.payload) else {
            continue;
        };
        // Only rows for THIS correlation (match forward — the derivation from
        // effort_id is lossy, so never reverse it).
        if value.get(&spec.correlation_key).and_then(|v| v.as_str())
            != Some(spec.correlation_value.as_str())
        {
            continue;
        }
        if value
            .get(&spec.terminal_flag_field)
            .and_then(|v| v.as_bool())
            == Some(true)
        {
            let content = value
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let is_error = value.get("is_error").and_then(|v| v.as_bool()) == Some(true);
            return Some(TerminalResult { content, is_error });
        }
    }
    None
}

/// Build the device-facing usage view from a `UsageRecord` CRDT node — the SAME
/// `{model, provider, usage:{...}}` shape the agent's direct respond path emits
/// (agent/src/lib.rs::build_respond_json), so every surface (a git-pull device
/// client, a compiled CLI/TUI/web) parses ONE wire contract regardless of path.
/// `usage_raw` is re-parsed into a nested object so a reader never has to unwrap
/// a JSON string. PURE.
fn usage_view_from_record(node: &serde_json::Value) -> serde_json::Value {
    let raw = node
        .get("usage_raw")
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    let count = |key: &str| node.get(key).cloned().unwrap_or_else(|| serde_json::json!(0));
    let mut usage = serde_json::json!({
        "tokens_in": count("tokens_in"),
        "tokens_out": count("tokens_out"),
        "tokens_cached": count("tokens_cached"),
        "cache_read_input_tokens": count("cache_read_input_tokens"),
        "cache_creation_input_tokens": count("cache_creation_input_tokens"),
        "tokens_reasoning": count("tokens_reasoning"),
        "pricing_mode": node.get("pricing_mode").cloned().unwrap_or(serde_json::Value::Null),
        "estimated_usd": node.get("estimated_usd").cloned().unwrap_or_else(|| serde_json::json!(0)),
        "raw": raw,
    });
    // The rate table that priced this run, joined in ONLY when the source UsageRecord
    // carries it. Omitted (never defaulted to null) for a record written before this
    // field existed — Task 10's BudgetObservation depends on that distinction (D6: an
    // undeterminable field is absent, not a manufactured zero/null) to tell a genuinely
    // unpriced run apart from one this crate simply cannot speak to yet.
    if let Some(v) = node.get("rate_table_version") {
        usage["rate_table_version"] = v.clone();
    }
    serde_json::json!({
        "model": node.get("model").cloned().unwrap_or(serde_json::Value::Null),
        "provider": node.get("provider").cloned().unwrap_or(serde_json::Value::Null),
        "usage": usage,
    })
}

/// Find the RAW `UsageRecord` CRDT node correlated to `prompt_ref` — no mapping
/// through `usage_view_from_record`. Extracted so there is exactly ONE row-scan
/// (`find_usage_for` below is now a thin wrapper over this), and so a caller
/// that needs to tell "the source record does not carry this field" apart from
/// "the field is zero" has somewhere to read from: `usage_view_from_record`'s
/// `count` helper (see its doc) defaults several fields to `0` on purpose, for
/// the device wire contract's back-compat guarantee — a guarantee that is
/// wrong for a DURABLE record (D6/F4). `sidecar::observation::write_budget_observation`
/// joins through THIS function rather than `find_usage_for`, so a pre-split
/// `UsageRecord` (no `cache_read_input_tokens`/`cache_creation_input_tokens`
/// key at all — Task 3 added the split; an unpriced-but-known run predates F5's
/// `price_known`) lands on the observation as ABSENT, never a manufactured
/// zero. `usage_view_from_record`'s existing keys/defaults are UNCHANGED — a
/// device-wire-contract test depends on them (`usage_view_maps_record_to_the_
/// device_wire_contract`).
pub(crate) fn find_usage_record_for(namespace: &str, prompt_ref: &str) -> Option<serde_json::Value> {
    let storage = crate::storage::NativeStorage::open(namespace).ok()?;
    let rows = storage.query_nodes("UsageRecord").ok()?;
    for row in rows {
        let Ok(node) = serde_json::from_str::<serde_json::Value>(&row.payload) else {
            continue;
        };
        if node.get("prompt_ref").and_then(|v| v.as_str()) == Some(prompt_ref) {
            return Some(node);
        }
    }
    None
}

/// The usage view for a respond effort, read from the correlated `UsageRecord`
/// node. The agent persists one per turn keyed by the same `prompt_ref` the
/// Response node carries, so `correlation_value` (the effort's prompt_ref) finds
/// it. Returns None for a workload that wrote no UsageRecord — the result then
/// stays content-only, unchanged. Additive and backward-compatible by design.
///
/// Device-facing ONLY: `sidecar::observation::write_budget_observation` joins
/// the raw node via `find_usage_record_for` instead (see that function's doc
/// for why) — this wrapper stays `pub(crate)` for the device-result call site
/// below, not for the observation.
pub(crate) fn find_usage_for(namespace: &str, prompt_ref: &str) -> Option<serde_json::Value> {
    find_usage_record_for(namespace, prompt_ref).map(|node| usage_view_from_record(&node))
}

/// Watch for the terminal RESULT node an effort awaits (described by `spec`) and
/// finalise the effort accordingly. A terminal success node finalises `done`; a
/// terminal `is_error` node finalises `failed` (a guest error surfaces here
/// instead of a 45s false `timed-out`); no terminal node by the deadline
/// finalises `timed-out`.
///
/// Generic over the result node — the agent's AgentResponse is just the default
/// spec. Uses `finalise_effort_if_active` so a concurrent cancel/error that
/// already made the effort terminal wins (the watcher never walks the machine
/// backward out of a terminal state). Bounded by `deadline_ms` — the effort's
/// resolved budget deadline (`dispatch_effort` resolves it once, up front; it
/// falls back to the node's default when nothing is declared) — so a silent
/// producer never leaks the task. `state.respond_watch.interval_ms` is the poll
/// cadence, not a budget, so it stays sourced from state.
fn spawn_terminal_result_watcher(
    state: SidecarState,
    effort_id: String,
    spec: TerminalResultSpec,
    deadline_ms: u64,
) {
    tokio::spawn(async move {
        let timeout = std::time::Duration::from_millis(deadline_ms);
        let interval = std::time::Duration::from_millis(state.respond_watch.interval_ms);
        let deadline = std::time::Instant::now() + timeout;

        loop {
            // Stop early if a concurrent path already finalised the effort
            // (e.g. a cancel). No point polling a terminal effort.
            {
                let s = state.efforts.read().expect("effort store poisoned");
                match s.get(&effort_id) {
                    Some(entry) if super::is_terminal_effort_status(&entry.status) => return,
                    None => return,
                    _ => {}
                }
            }

            if let Some(result) = find_terminal_result(&state.namespace, &spec) {
                if result.is_error {
                    finalise_effort_if_active(
                        &state,
                        &effort_id,
                        super::EFFORT_FAILED,
                        vec![TaskResult {
                            status: "error".to_string(),
                            result: None,
                            error: Some(result.content),
                        }],
                    );
                } else {
                    // Enrich the success result with the correlated UsageRecord so
                    // spend (tokens + estimated cost) reaches the caller — the same
                    // wire contract every surface reads. Additive: a workload that
                    // wrote no UsageRecord keeps the content-only result.
                    let mut payload = serde_json::json!({ "content": result.content });
                    if let Some(usage) = find_usage_for(&state.namespace, &spec.correlation_value) {
                        if let (Some(obj), Some(extra)) = (payload.as_object_mut(), usage.as_object())
                        {
                            for (key, value) in extra {
                                obj.insert(key.clone(), value.clone());
                            }
                        }
                    }
                    finalise_effort_if_active(
                        &state,
                        &effort_id,
                        super::EFFORT_DONE,
                        vec![TaskResult {
                            status: "ok".to_string(),
                            result: Some(payload),
                            error: None,
                        }],
                    );
                }
                return;
            }

            if std::time::Instant::now() >= deadline {
                let finalised = finalise_effort_if_active(
                    &state,
                    &effort_id,
                    "timed-out",
                    vec![TaskResult {
                        status: "timeout".to_string(),
                        result: None,
                        error: Some(format!(
                            "no terminal {} within {}ms",
                            spec.node_type, deadline_ms
                        )),
                    }],
                );
                if finalised {
                    tracing::warn!(
                        effort_id = %effort_id,
                        node_type = %spec.node_type,
                        "effort timed out waiting for a terminal result node"
                    );
                }
                return;
            }

            tokio::time::sleep(interval).await;
        }
    });
}

/// Current time as an ISO-8601 `YYYY-MM-DDTHH:MM:SS.sssZ` string, via the shared `time`-backed
/// `timefmt` module (the hand-rolled proleptic-Gregorian math — with its documented leap-year bug —
/// was retired).
///
/// Millisecond precision, matching what every client already stamps `submittedAt` with. The
/// seconds-only form this used to emit made `refarm.elapsed_ms` unusable for anything faster than a
/// second (see `record_budget_observation`), and left this the only timestamp in the system coarser
/// than its own siblings. Readers parse through `timefmt`, which accepts both shapes, so stamps
/// written before this change still reap and still sort.
pub(crate) fn chrono_now_iso() -> String {
    crate::timefmt::now_iso_millis()
}

// ── route handlers ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::env_lock;
    use serde_json::json;
    use super::super::budget::{resolve_budget, BudgetDeclaration, BudgetTriple, NodeBudget};

    // ── input builders ────────────────────────────────────────────────────────

    // Same node fixture `sidecar::tests::budget` uses (mirrors the TS
    // conformance list's fixture): 100_000 tokens / $1 default, 500_000 / $10
    // ceiling. Duplicated rather than shared because that module's own `node()`
    // is private to it, and this file's protected-surface authorisation (Task
    // 12) is `dispatch.rs` only — reaching into `budget.rs` to make it `pub`
    // would be an out-of-scope edit for one shared test helper.
    fn node() -> NodeBudget {
        NodeBudget {
            ceiling: BudgetTriple { deadline_ms: 600_000, max_tokens: 500_000, max_usd_millis: 10_000 },
            default: BudgetTriple { deadline_ms: 45_000, max_tokens: 100_000, max_usd_millis: 1_000 },
        }
    }

    fn task(plugin_id: &str, fn_name: Option<&str>, args: Value) -> EffortTask {
        EffortTask {
            id: "t-1".to_string(),
            plugin_id: plugin_id.to_string(),
            fn_name: fn_name.map(str::to_string),
            args,
        }
    }

    fn effort_with(tasks: Vec<EffortTask>) -> Effort {
        Effort {
            id: "e-1".to_string(),
            direction: None,
            tasks,
            source: None,
            submitted_at: "2026-01-01T00:00:00Z".to_string(),
            budget: None,
            workspace_id: None,
            workspace_source: None,
            scenario_id: None,
            credential_id: None,
            expectation: None,
        }
    }

    // ── effort_activity_label ─────────────────────────────────────────────────

    #[test]
    fn label_reads_respond_task_as_agent_responding() {
        let e = effort_with(vec![task("@refarm/agent", Some("respond"), Value::Null)]);
        assert_eq!(effort_activity_label(&e), "Agent responding");
    }

    #[test]
    fn label_treats_missing_fn_name_as_respond() {
        // fn_name None defaults to "respond" via unwrap_or.
        let e = effort_with(vec![task("@refarm/agent", None, Value::Null)]);
        assert_eq!(effort_activity_label(&e), "Agent responding");
    }

    #[test]
    fn label_bare_fn_without_plugin_id_omits_namespace() {
        let e = effort_with(vec![task("", Some("extract"), Value::Null)]);
        assert_eq!(effort_activity_label(&e), "Running extract");
    }

    #[test]
    fn label_qualifies_verb_with_plugin_id() {
        let e = effort_with(vec![task("vault", Some("extract"), Value::Null)]);
        assert_eq!(effort_activity_label(&e), "Running vault::extract");
    }

    #[test]
    fn label_taskless_effort_reads_working() {
        let e = effort_with(vec![]);
        assert_eq!(effort_activity_label(&e), "Working");
    }

    // ── effort_activity_kind ──────────────────────────────────────────────────

    #[test]
    fn kind_respond_is_agent() {
        let e = effort_with(vec![task("@refarm/agent", Some("respond"), Value::Null)]);
        assert_eq!(effort_activity_kind(&e), "agent");
    }

    #[test]
    fn kind_missing_fn_name_is_agent() {
        // first().and_then(fn_name) yields None → agent arm.
        let e = effort_with(vec![task("@refarm/agent", None, Value::Null)]);
        assert_eq!(effort_activity_kind(&e), "agent");
    }

    #[test]
    fn kind_taskless_effort_is_agent() {
        let e = effort_with(vec![]);
        assert_eq!(effort_activity_kind(&e), "agent");
    }

    #[test]
    fn kind_other_verb_is_dispatch() {
        let e = effort_with(vec![task("vault", Some("extract"), Value::Null)]);
        assert_eq!(effort_activity_kind(&e), "dispatch");
    }

    // ── effort_status_is_ok ───────────────────────────────────────────────────

    #[test]
    fn status_done_delivered_partial_are_ok() {
        assert!(effort_status_is_ok("done"));
        assert!(effort_status_is_ok("delivered"));
        assert!(effort_status_is_ok("partial"));
    }

    #[test]
    fn status_failure_states_are_not_ok() {
        assert!(!effort_status_is_ok("failed"));
        assert!(!effort_status_is_ok("timed-out"));
        assert!(!effort_status_is_ok("cancelled"));
        assert!(!effort_status_is_ok("in-progress"));
        assert!(!effort_status_is_ok(""));
    }

    // ── extract_task_args ─────────────────────────────────────────────────────

    #[test]
    fn extract_args_reads_prompt_and_trims_it() {
        let t = task("@refarm/agent", Some("respond"), json!({ "prompt": "  hello  " }));
        let args = extract_task_args(&t).expect("prompt present");
        assert_eq!(args.prompt, "hello");
        assert_eq!(args.system, None);
        assert_eq!(args.session_id, None);
        assert_eq!(args.history_turns, None);
        assert_eq!(args.provider, None);
        assert_eq!(args.model, None);
        assert_eq!(args.profile, None);
    }

    #[test]
    fn extract_args_falls_back_to_query_field() {
        let t = task("@refarm/agent", Some("respond"), json!({ "query": "who am i" }));
        let args = extract_task_args(&t).expect("query is a prompt alias");
        assert_eq!(args.prompt, "who am i");
    }

    #[test]
    fn extract_args_populates_all_optional_fields() {
        let t = task(
            "@refarm/agent",
            Some("respond"),
            json!({
                "prompt": "hi",
                "system": "be terse",
                "session_id": "s-1",
                "history_turns": 7,
                "provider": "  openai  ",
                "model": " gpt-5.5 ",
                "profile": " cheap "
            }),
        );
        let args = extract_task_args(&t).unwrap();
        assert_eq!(args.system.as_deref(), Some("be terse"));
        assert_eq!(args.session_id.as_deref(), Some("s-1"));
        assert_eq!(args.history_turns, Some(7));
        // provider/model/profile are trimmed.
        assert_eq!(args.provider.as_deref(), Some("openai"));
        assert_eq!(args.model.as_deref(), Some("gpt-5.5"));
        assert_eq!(args.profile.as_deref(), Some("cheap"));
    }

    #[test]
    fn extract_args_filters_empty_session_and_whitespace_provider() {
        let t = task(
            "@refarm/agent",
            Some("respond"),
            json!({
                "prompt": "hi",
                "session_id": "",
                "provider": "   ",
                "model": "",
                "profile": "  "
            }),
        );
        let args = extract_task_args(&t).unwrap();
        assert_eq!(args.session_id, None);
        assert_eq!(args.provider, None);
        assert_eq!(args.model, None);
        assert_eq!(args.profile, None);
    }

    #[test]
    fn extract_args_reads_the_declared_workspace() {
        let t = task(
            "@refarm/agent",
            Some("respond"),
            json!({
                "prompt": "hi",
                "workspace_id": "  rcdc5  ",
                "workspace_source": " declared "
            }),
        );
        let args = extract_task_args(&t).unwrap();
        assert_eq!(args.workspace_id.as_deref(), Some("rcdc5"));
        assert_eq!(args.workspace_source.as_deref(), Some("declared"));
    }

    #[test]
    fn extract_args_leaves_an_undeclared_workspace_absent() {
        let t = task(
            "@refarm/agent",
            Some("respond"),
            json!({ "prompt": "hi", "workspace_id": "   " }),
        );
        let args = extract_task_args(&t).unwrap();
        assert_eq!(args.workspace_id, None);
        assert_eq!(args.workspace_source, None);
    }

    // ── respond_payload_json (the guest can only learn what this forwards) ──────

    fn args_with_workspace(id: Option<&str>, source: Option<&str>) -> TaskArgs {
        TaskArgs {
            credential_id: None,
            base_url: None,
            prompt: "hi".to_string(),
            system: None,
            session_id: Some("urn:sovereign:session:v1:abc".to_string()),
            history_turns: Some(10),
            provider: None,
            model: None,
            profile: None,
            workspace_id: id.map(|s| s.to_string()),
            workspace_source: source.map(|s| s.to_string()),
        }
    }

    /// The regression this whole task exists for. The CLI put `workspace_id` in the
    /// task args and the sidecar dropped it on the floor building this payload, so the
    /// guest's `handle_prompt` never saw it, never set MODEL_WORKSPACE_ID, and every
    /// Session node was created unattributed — which made a later turn in the same
    /// session silently re-seed from the operator's cwd.
    #[test]
    fn respond_payload_forwards_the_declared_workspace_to_the_guest() {
        let payload = respond_payload_json(
            &args_with_workspace(Some("rcdc5"), Some("declared")),
            "prompt-ref-1",
            None,
            None,
        );
        assert_eq!(
            payload["workspace_id"], "rcdc5",
            "the guest stamps the Session node from this field; dropping it breaks \
             same-session inheritance with no error anywhere"
        );
        assert_eq!(payload["workspace_source"], "declared");
        // The fields that already worked must keep working.
        assert_eq!(payload["prompt"], "hi");
        assert_eq!(payload["prompt_ref"], "prompt-ref-1");
        assert_eq!(payload["session_id"], "urn:sovereign:session:v1:abc");
        assert_eq!(payload["history_turns"], 10);
    }

    #[test]
    fn respond_payload_omits_an_undeclared_workspace_entirely() {
        let payload = respond_payload_json(&args_with_workspace(None, None), "pr", None, None);
        assert!(
            payload.get("workspace_id").is_none(),
            "absent, not null: a null would read as a declaration of nothing"
        );
        assert!(payload.get("workspace_source").is_none());
    }

    #[test]
    fn respond_payload_still_carries_route_and_ceilings() {
        let mut args = args_with_workspace(Some("refarm"), Some("seeded-from-cwd"));
        args.system = Some("be terse".to_string());
        args.provider = Some("anthropic".to_string());
        args.model = Some("claude-opus-5".to_string());
        args.profile = Some("cheap".to_string());
        let payload = respond_payload_json(&args, "pr", Some(4096), Some(0.25));
        assert_eq!(payload["system"], "be terse");
        assert_eq!(payload["provider"], "anthropic");
        assert_eq!(payload["model"], "claude-opus-5");
        assert_eq!(payload["profile"], "cheap");
        assert_eq!(payload["max_tokens"], 4096);
        assert_eq!(payload["max_usd"], 0.25);
        assert_eq!(payload["workspace_source"], "seeded-from-cwd");
    }

    #[test]
    fn extract_args_errors_when_prompt_missing() {
        let t = task("@refarm/agent", Some("respond"), json!({ "system": "x" }));
        let err = extract_task_args(&t).unwrap_err();
        assert!(err.contains("requires args.prompt"), "got: {err}");
    }

    #[test]
    fn extract_args_errors_when_prompt_blank() {
        let t = task("@refarm/agent", Some("respond"), json!({ "prompt": "   " }));
        assert!(extract_task_args(&t).is_err());
    }

    // ── ceilings_for_payload (Task 12: the ceiling reaches the agent) ────────────

    #[test]
    fn a_dispatch_with_no_declared_budget_puts_nothing_in_the_payload() {
        // Backward compatibility (D2 / controller resolution #2): an effort that
        // never declares a budget must not suddenly inherit the node's own
        // structural default (100_000 tokens / $1 today) as a live ceiling — an
        // absent declaration must read as an absent key, never a value (and
        // certainly never a zero).
        let resolved = resolve_budget(None, None, &node());
        assert_eq!(ceilings_for_payload(&resolved), (None, None));
    }

    #[test]
    fn a_declared_budget_puts_the_resolved_ceilings_in_the_payload() {
        let declared = BudgetDeclaration {
            max_tokens: Some(1_000),
            max_usd_millis: Some(2_500),
            ..Default::default()
        };
        let resolved = resolve_budget(Some(&declared), None, &node());
        assert_eq!(
            ceilings_for_payload(&resolved),
            (Some(1_000), Some(2.5)),
            "max_usd converts back from millis to decimal dollars"
        );
    }

    #[test]
    fn a_declared_budget_clamped_by_the_node_ceiling_forwards_the_clamped_value() {
        // The payload must carry what actually governs the run (the clamped
        // `effective`), not the raw over-ceiling ask — and each axis is gated
        // independently: only max_tokens was declared here, so max_usd stays
        // absent even though max_tokens got clamped.
        let declared = BudgetDeclaration {
            max_tokens: Some(9_000_000),
            ..Default::default()
        };
        let resolved = resolve_budget(Some(&declared), None, &node());
        let (max_tokens, max_usd) = ceilings_for_payload(&resolved);
        assert_eq!(max_tokens, Some(500_000), "clamped to the node ceiling, not the raw ask");
        assert_eq!(max_usd, None, "the usd axis was never declared");
    }

    // ── respond_watch_*_from_env ──────────────────────────────────────────────

    #[test]
    fn respond_watch_timeout_reads_env_and_defaults() {
        let _guard = env_lock();
        let key = "REFARM_RESPOND_WATCH_TIMEOUT_MS";
        let prev = std::env::var(key).ok();

        std::env::remove_var(key);
        assert_eq!(respond_watch_timeout_ms_from_env(), 45_000, "absent → default");

        std::env::set_var(key, "1234");
        assert_eq!(respond_watch_timeout_ms_from_env(), 1234, "valid value passes through");

        std::env::set_var(key, "0");
        assert_eq!(respond_watch_timeout_ms_from_env(), 45_000, "zero filtered → default");

        std::env::set_var(key, "not-a-number");
        assert_eq!(respond_watch_timeout_ms_from_env(), 45_000, "unparseable → default");

        match prev {
            Some(v) => std::env::set_var(key, v),
            None => std::env::remove_var(key),
        }
    }

    #[test]
    fn respond_watch_interval_reads_env_and_defaults() {
        let _guard = env_lock();
        let key = "REFARM_RESPOND_WATCH_INTERVAL_MS";
        let prev = std::env::var(key).ok();

        std::env::remove_var(key);
        assert_eq!(respond_watch_interval_ms_from_env(), 100, "absent → default");

        std::env::set_var(key, "250");
        assert_eq!(respond_watch_interval_ms_from_env(), 250, "valid value passes through");

        std::env::set_var(key, "0");
        assert_eq!(respond_watch_interval_ms_from_env(), 100, "zero filtered → default");

        std::env::set_var(key, "abc");
        assert_eq!(respond_watch_interval_ms_from_env(), 100, "unparseable → default");

        match prev {
            Some(v) => std::env::set_var(key, v),
            None => std::env::remove_var(key),
        }
    }

    // ── find_terminal_result ──────────────────────────────────────────────────

    /// Run `f` with `XDG_DATA_HOME` pointed at a throwaway temp dir, so
    /// `NativeStorage::open(namespace)` reads/writes an isolated on-disk db that
    /// is deleted when the temp dir drops. Serialized via `env_lock`.
    fn with_isolated_storage<R>(f: impl FnOnce() -> R) -> R {
        let _guard = env_lock();
        let dir = tempfile::tempdir().unwrap();
        let prev = std::env::var("XDG_DATA_HOME").ok();
        std::env::set_var("XDG_DATA_HOME", dir.path());
        let out = f();
        match prev {
            Some(v) => std::env::set_var("XDG_DATA_HOME", v),
            None => std::env::remove_var("XDG_DATA_HOME"),
        }
        out
    }

    fn store_response_node(namespace: &str, id: &str, payload: Value) {
        let store = crate::storage::NativeStorage::open(namespace).unwrap();
        store
            .store_node(id, AGENT_RESPONSE_NODE_TYPE, None, &payload.to_string(), None)
            .unwrap();
    }

    fn store_usage_node(namespace: &str, id: &str, payload: Value) {
        let store = crate::storage::NativeStorage::open(namespace).unwrap();
        store
            .store_node(id, "UsageRecord", None, &payload.to_string(), None)
            .unwrap();
    }

    #[test]
    fn usage_view_maps_record_to_the_device_wire_contract() {
        // A real UsageRecord (from the live DB): usage_raw is a JSON *string*.
        let node = json!({
            "@type": "UsageRecord",
            "prompt_ref": "p-1",
            "provider": "openai-codex",
            "model": "gpt-5.5",
            "tokens_in": 1359,
            "tokens_out": 5,
            "tokens_cached": 0,
            "tokens_reasoning": 0,
            "pricing_mode": "subscription",
            "estimated_usd": 0.0,
            "usage_raw": "{\"input_tokens\":1359,\"input_tokens_details\":{\"cached_tokens\":0},\"output_tokens\":5}"
        });
        let view = usage_view_from_record(&node);
        assert_eq!(view["model"], "gpt-5.5");
        assert_eq!(view["provider"], "openai-codex");
        assert_eq!(view["usage"]["tokens_in"], 1359);
        assert_eq!(view["usage"]["tokens_out"], 5);
        assert_eq!(view["usage"]["pricing_mode"], "subscription");
        // usage_raw is re-parsed into a nested object, never left as a string.
        assert_eq!(view["usage"]["raw"]["input_tokens"], 1359);
        assert_eq!(view["usage"]["raw"]["input_tokens_details"]["cached_tokens"], 0);
        // Legacy pre-split record: neither cache key is present, so both default
        // to 0 through the `count` helper. Pins the back-compat default — a
        // separate, still-true rule from the split-record case below.
        assert_eq!(view["usage"]["cache_read_input_tokens"], 0);
        assert_eq!(view["usage"]["cache_creation_input_tokens"], 0);
    }

    #[test]
    fn usage_view_surfaces_the_split_cache_keys_when_the_record_carries_them() {
        // A record that actually carries the two cache-split keys Task 3 added.
        // The legacy test above proves the 0-default; this proves the two keys
        // surface with their OWN distinct values rather than defaulting.
        let node = json!({
            "@type": "UsageRecord",
            "prompt_ref": "p-1",
            "provider": "anthropic",
            "model": "claude-5.5-sonnet",
            "tokens_in": 1359,
            "tokens_out": 5,
            "tokens_cached": 0,
            "cache_read_input_tokens": 100_000,
            "cache_creation_input_tokens": 2_048,
            "tokens_reasoning": 0,
            "pricing_mode": "subscription",
            "estimated_usd": 0.0,
            "usage_raw": "{}"
        });
        let view = usage_view_from_record(&node);
        assert_eq!(view["usage"]["cache_read_input_tokens"], 100_000);
        assert_eq!(view["usage"]["cache_creation_input_tokens"], 2_048);
    }

    #[test]
    fn find_usage_for_matches_prompt_ref_and_ignores_others() {
        with_isolated_storage(|| {
            let ns = "usage-corr";
            store_usage_node(
                ns,
                "urn:usage:1",
                json!({
                    "prompt_ref": "p-1", "provider": "openai-codex", "model": "gpt-5.5",
                    "tokens_in": 10, "tokens_out": 2, "pricing_mode": "subscription",
                    "estimated_usd": 0.0, "usage_raw": "{}"
                }),
            );
            store_usage_node(
                ns,
                "urn:usage:2",
                json!({ "prompt_ref": "p-OTHER", "model": "y", "tokens_in": 99, "usage_raw": "{}" }),
            );
            let view = find_usage_for(ns, "p-1").expect("usage for p-1 exists");
            assert_eq!(view["usage"]["tokens_in"], 10);
            assert_eq!(view["model"], "gpt-5.5");
            assert!(find_usage_for(ns, "p-NONE").is_none());
        });
    }

    #[test]
    fn find_terminal_result_returns_matching_final_node() {
        with_isolated_storage(|| {
            let ns = "ftr-match";
            store_response_node(
                ns,
                "urn:resp:1",
                json!({ "prompt_ref": "p-1", "is_final": true, "content": "the answer" }),
            );
            let spec = TerminalResultSpec::agent_response("p-1");
            let found = find_terminal_result(ns, &spec).expect("a terminal node exists");
            assert_eq!(found.content, "the answer");
            assert!(!found.is_error);
        });
    }

    #[test]
    fn find_terminal_result_flags_error_nodes() {
        with_isolated_storage(|| {
            let ns = "ftr-error";
            store_response_node(
                ns,
                "urn:resp:1",
                json!({ "prompt_ref": "p-1", "is_final": true, "content": "boom", "is_error": true }),
            );
            let spec = TerminalResultSpec::agent_response("p-1");
            let found = find_terminal_result(ns, &spec).unwrap();
            assert_eq!(found.content, "boom");
            assert!(found.is_error);
        });
    }

    #[test]
    fn find_terminal_result_ignores_other_correlations() {
        with_isolated_storage(|| {
            let ns = "ftr-other-corr";
            // A terminal node, but for a DIFFERENT prompt_ref.
            store_response_node(
                ns,
                "urn:resp:1",
                json!({ "prompt_ref": "p-OTHER", "is_final": true, "content": "not mine" }),
            );
            let spec = TerminalResultSpec::agent_response("p-1");
            assert!(find_terminal_result(ns, &spec).is_none());
        });
    }

    #[test]
    fn find_terminal_result_ignores_non_final_nodes() {
        with_isolated_storage(|| {
            let ns = "ftr-non-final";
            // Correct correlation, but not yet terminal.
            store_response_node(
                ns,
                "urn:resp:1",
                json!({ "prompt_ref": "p-1", "is_final": false, "content": "streaming" }),
            );
            let spec = TerminalResultSpec::agent_response("p-1");
            assert!(find_terminal_result(ns, &spec).is_none());
        });
    }

    #[test]
    fn find_terminal_result_none_on_empty_store() {
        // `:memory:` opens a fresh, empty in-memory db (no disk) → no rows → None.
        let spec = TerminalResultSpec::agent_response("p-1");
        assert!(find_terminal_result(":memory:", &spec).is_none());
    }
}
