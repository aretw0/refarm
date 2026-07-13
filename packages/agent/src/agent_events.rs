//! AgentEvent stream — the agent's lifecycle emitted as `agent:*` telemetry.
//!
//! The agent narrates its own run: it received a prompt, ran the Nth react
//! iteration, invoked a tool, produced a response, hit an error or a budget wall.
//! Each is a `TelemetryEvent` named `agent:<phase>` carrying a small JSON payload,
//! emitted through the SAME host `emit-telemetry` primitive host effects already use
//! (no new WIT). The tractor's capability-driven observer (ADR-067) routes them, by
//! the `agent:` prefix, to any plugin that declared `observe-agent-events` — exactly
//! as it routes `host-effect:*` to `observe-host-effects` observers. The agent does
//! not know who (if anyone) is listening; emitting is fire-and-forget and free when
//! no observer is loaded.
//!
//! The event NAMES and payload SHAPING are pure and native-testable here; the wasm
//! guest is a thin `emit_telemetry` call over them. Payloads are intentionally small
//! (ids, counts, names, a truncated summary) — never the full prompt/response body,
//! which lives in the graph as its own nodes; an observer correlates by `prompt_ref`.

/// The event-name prefix the tractor observer routes on. Mirrors the host-effect
/// `host-effect:` convention; declared once so guest and any test agree.
pub(crate) const AGENT_EVENT_PREFIX: &str = "agent:";

// ── ambient run context ─────────────────────────────────────────────────────────
//
// The deep provider loop (iteration ticks, per-tool dispatch, budget/error paths)
// would need `prompt_ref` threaded through five signatures to emit a correlated
// event. Instead the run's `prompt_ref` is stashed in a THREAD-LOCAL for the
// duration of the run — the agent processes one prompt per runner thread, so this
// is unambiguous — and the deep emit points read it. This is the standard ambient-
// observability-context pattern: it keeps `prompt_ref` out of hot-path signatures
// that have no other use for it. Set once at the top of `execute_prompt`; the emit
// points below no-op (empty ref) if somehow called outside a run.
#[cfg(target_arch = "wasm32")]
mod run_context {
    use std::cell::RefCell;
    thread_local! {
        static ACTIVE_PROMPT_REF: RefCell<String> = const { RefCell::new(String::new()) };
    }

    /// Bind `prompt_ref` as the active run for this thread (called at run start).
    pub(crate) fn enter(prompt_ref: &str) {
        ACTIVE_PROMPT_REF.with(|r| *r.borrow_mut() = prompt_ref.to_string());
    }

    /// The active run's `prompt_ref`, or empty outside a run.
    pub(crate) fn current() -> String {
        ACTIVE_PROMPT_REF.with(|r| r.borrow().clone())
    }
}
#[cfg(target_arch = "wasm32")]
pub(crate) use run_context::enter as enter_run;

/// The six lifecycle phases of a run, as `agent:<phase>` event names.
pub(crate) const EVENT_PROMPT_START: &str = "agent:prompt:start";
pub(crate) const EVENT_ITERATION: &str = "agent:iteration";
pub(crate) const EVENT_TOOL_CALL: &str = "agent:tool:call";
pub(crate) const EVENT_RESPONSE_DONE: &str = "agent:response:done";
pub(crate) const EVENT_ERROR: &str = "agent:error";
pub(crate) const EVENT_BUDGET_BLOCKED: &str = "agent:budget:blocked";
/// ADR-012 audit trail: the router chose a `(provider, model)` route, and WHY.
pub(crate) const EVENT_ROUTE_SELECTED: &str = "agent:route:selected";

/// How many chars of a free-text summary (tool args, error message) an event
/// carries. Events are for observation, not transport — the full text is in the
/// graph. Keeps a single tool call from emitting a megabyte of args.
const SUMMARY_MAX: usize = 200;

/// Truncate a summary string to `SUMMARY_MAX` chars, appending an ellipsis marker
/// when clipped (so an observer can tell a value was cut). PURE.
pub(crate) fn truncate_summary(s: &str) -> String {
    if s.chars().count() <= SUMMARY_MAX {
        return s.to_string();
    }
    let clipped: String = s.chars().take(SUMMARY_MAX).collect();
    format!("{clipped}…")
}

/// `agent:prompt:start` — a run began. Carries the correlation key every later
/// event of this run shares (`prompt_ref`) plus the session it belongs to. PURE.
pub(crate) fn prompt_start_payload(prompt_ref: &str, session_id: &str) -> serde_json::Value {
    serde_json::json!({ "prompt_ref": prompt_ref, "session_id": session_id })
}

/// `agent:iteration` — the react loop entered iteration `index` (0-based) of a
/// `max`-iteration budget. Lets an observer spot a looping/runaway agent. PURE.
pub(crate) fn iteration_payload(prompt_ref: &str, index: u32, max: u32) -> serde_json::Value {
    serde_json::json!({ "prompt_ref": prompt_ref, "iteration": index, "max": max })
}

/// `agent:tool:call` — the model invoked tool `name`. `args_summary` is a truncated
/// rendering of the call input (never the full body); `ok` is whether it succeeded.
/// This is the turn-by-turn window into the agent's reasoning. PURE.
pub(crate) fn tool_call_payload(
    prompt_ref: &str,
    name: &str,
    args_summary: &str,
    ok: bool,
) -> serde_json::Value {
    serde_json::json!({
        "prompt_ref": prompt_ref,
        "tool": name,
        "args_summary": truncate_summary(args_summary),
        "ok": ok,
    })
}

/// `agent:response:done` — the run produced its final response. Carries the shape of
/// the answer (content length, tool-call count, tokens, wall-ms) — an observer reads
/// the full content from the AgentResponse node by `prompt_ref`. PURE.
pub(crate) fn response_done_payload(
    prompt_ref: &str,
    content_len: usize,
    tool_call_count: usize,
    tokens_in: u32,
    tokens_out: u32,
    duration_ms: u64,
) -> serde_json::Value {
    serde_json::json!({
        "prompt_ref": prompt_ref,
        "content_len": content_len,
        "tool_calls": tool_call_count,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "duration_ms": duration_ms,
    })
}

/// `agent:error` — the run failed with `message` (a truncated summary). The terminal
/// failure signal an operator most needs. PURE.
pub(crate) fn error_payload(prompt_ref: &str, message: &str) -> serde_json::Value {
    serde_json::json!({ "prompt_ref": prompt_ref, "error": truncate_summary(message) })
}

/// `agent:budget:blocked` — the run was refused/halted because `provider`'s spend
/// guard tripped. Distinct from a generic error so an observer can act on cost. PURE.
pub(crate) fn budget_blocked_payload(prompt_ref: &str, provider: &str) -> serde_json::Value {
    serde_json::json!({ "prompt_ref": prompt_ref, "provider": provider })
}

/// `agent:route:selected` — the ADR-012 audit trail. Records which `provider`/`model`
/// the router chose for this run and HOW: `source` is `override` (explicit route arg),
/// `profile:<name>` (a named profile resolved), or `env` (MODEL_PROVIDER/default fell
/// through); `cost_tier` is the chosen route's declared tier. This is the "why this
/// route" record the ADR called for — an observer reconstructs routing decisions
/// per-run by `prompt_ref`, distinct from the fallback/budget events. PURE.
pub(crate) fn route_selected_payload(
    prompt_ref: &str,
    provider: &str,
    model: &str,
    source: &str,
    cost_tier: &str,
) -> serde_json::Value {
    serde_json::json!({
        "prompt_ref": prompt_ref,
        "provider": provider,
        "model": model,
        "source": source,
        "cost_tier": cost_tier,
    })
}

// ── wasm guest: thin emit over the pure shapers ─────────────────────────────────
#[cfg(target_arch = "wasm32")]
mod emit {
    use super::*;
    use crate::plugin::host::tractor_bridge;

    fn emit(event: &str, payload: serde_json::Value) {
        tractor_bridge::emit_telemetry(event, Some(&payload.to_string()));
    }

    pub(crate) fn prompt_start(prompt_ref: &str, session_id: &str) {
        emit(EVENT_PROMPT_START, prompt_start_payload(prompt_ref, session_id));
    }

    /// Deep-path emits read the run's `prompt_ref` from the ambient context, so the
    /// hot-path callers (the provider loop, the tool dispatcher) pass none.
    pub(crate) fn iteration(index: u32, max: u32) {
        let prompt_ref = super::run_context::current();
        emit(EVENT_ITERATION, iteration_payload(&prompt_ref, index, max));
    }

    pub(crate) fn tool_call(name: &str, args_summary: &str, ok: bool) {
        let prompt_ref = super::run_context::current();
        emit(EVENT_TOOL_CALL, tool_call_payload(&prompt_ref, name, args_summary, ok));
    }

    pub(crate) fn response_done(
        prompt_ref: &str,
        content_len: usize,
        tool_call_count: usize,
        tokens_in: u32,
        tokens_out: u32,
        duration_ms: u64,
    ) {
        emit(
            EVENT_RESPONSE_DONE,
            response_done_payload(
                prompt_ref,
                content_len,
                tool_call_count,
                tokens_in,
                tokens_out,
                duration_ms,
            ),
        );
    }

    pub(crate) fn error(message: &str) {
        let prompt_ref = super::run_context::current();
        emit(EVENT_ERROR, error_payload(&prompt_ref, message));
    }

    pub(crate) fn budget_blocked(provider: &str) {
        let prompt_ref = super::run_context::current();
        emit(EVENT_BUDGET_BLOCKED, budget_blocked_payload(&prompt_ref, provider));
    }

    pub(crate) fn route_selected(provider: &str, model: &str, source: &str, cost_tier: &str) {
        let prompt_ref = super::run_context::current();
        emit(
            EVENT_ROUTE_SELECTED,
            route_selected_payload(&prompt_ref, provider, model, source, cost_tier),
        );
    }
}

// On non-wasm (native tests, host builds) the emit calls are no-ops: there is no
// host telemetry import, and the pure shapers above are what the tests exercise.
#[cfg(not(target_arch = "wasm32"))]
mod emit {
    pub(crate) fn prompt_start(_prompt_ref: &str, _session_id: &str) {}
    pub(crate) fn iteration(_index: u32, _max: u32) {}
    pub(crate) fn tool_call(_name: &str, _args_summary: &str, _ok: bool) {}
    pub(crate) fn response_done(
        _prompt_ref: &str,
        _content_len: usize,
        _tool_call_count: usize,
        _tokens_in: u32,
        _tokens_out: u32,
        _duration_ms: u64,
    ) {
    }
    pub(crate) fn error(_message: &str) {}
    pub(crate) fn budget_blocked(_provider: &str) {}
    pub(crate) fn route_selected(
        _provider: &str,
        _model: &str,
        _source: &str,
        _cost_tier: &str,
    ) {
    }
}

/// Bind the active run's `prompt_ref` (no-op off-wasm; the deep emits are no-ops too).
#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn enter_run(_prompt_ref: &str) {}

// On native these re-exports are unused (the emit call-sites are wasm-gated); the
// payloads they wrap are still covered by the native tests below.
#[allow(unused_imports)]
pub(crate) use emit::{
    budget_blocked, error, iteration, prompt_start, response_done, route_selected, tool_call,
};

#[cfg(test)]
mod tests;
