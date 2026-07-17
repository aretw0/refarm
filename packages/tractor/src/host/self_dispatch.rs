// SELF-DISPATCH re-entrancy — a plugin invoking a verb on its OWN id.
//
// `dispatch_to_plugin` normally emits a `<key>:dispatch` EVENT and parks in
// `await_dispatch_result` polling the graph for the target's `DispatchResult` node. That
// works between DISTINCT plugins. It DEADLOCKS when the target IS the caller: the caller's
// single runner thread is the only one that can drain its own dispatch event, but it is
// parked in the await — head-of-line block, never resolves.
//
// The escape: when the target id equals the caller id, do NOT go through the event +
// runner at all. Run the verb on a FRESH instance (its own store + session) via the
// `self_respond` spawner wired at boot, and return the result inline. This is implicit —
// no manifest flag: any plugin whose verb is dispatchable is self-dispatchable, exactly as
// declaring verbs makes them dispatchable with no flag. The compiled Component is cached by
// hash, so the fresh instance is a cache-hit cold-init, not a recompile.
//
// Depth guard: a sub-turn can itself self-dispatch (an agent delegating to an agent that
// delegates again). Each level runs a fresh instance, so unbounded recursion would exhaust
// instances / stack. `MODEL_SUBAGENT_DEPTH` counts the live nesting; past the ceiling the
// dispatch is refused with an honest error instead of recursing. The counter rides the
// process env (like the agent's other MODEL_* knobs) and is only ever read/written on the
// serial self-dispatch path (the parent is blocked awaiting), so there is no cross-turn race.

use crate::host::wasi_bridge::CrossPluginAccess;

/// The node `@type` + correlation field a dispatched verb's result is wrapped in — the
/// same shape the guest's `on_event` handler stores for a cross-plugin dispatch, so a
/// caller sees an IDENTICAL result whether the verb ran cross-plugin or self.
const DISPATCH_RESULT_TYPE: &str = "DispatchResult";
const REPLY_REF_FIELD: &str = "replyRef";
const RESULT_FIELD: &str = "result";

/// Env var carrying the current self-dispatch nesting depth (a decimal count).
const SUBAGENT_DEPTH_ENV: &str = "MODEL_SUBAGENT_DEPTH";
/// The maximum self-dispatch nesting. A sub-agent MAY delegate again, but only so deep —
/// each level is a fresh live instance, so this bounds instance count + recursion. Chosen
/// small: real delegation is shallow (a parent hands off a task, the child maybe hands off
/// once more); deeper is far more likely a loop than intent.
const MAX_SUBAGENT_DEPTH: u32 = 4;

/// True when `verb` on `target_id` dispatched by `caller_id` is a SELF-dispatch (same
/// plugin). The one predicate `dispatch_to_plugin` branches on.
pub(crate) fn is_self_dispatch(caller_id: &str, target_id: &str) -> bool {
    !caller_id.is_empty() && caller_id == target_id
}

/// Read the current nesting depth from the env (absent/garbage → 0).
fn current_depth() -> u32 {
    std::env::var(SUBAGENT_DEPTH_ENV)
        .ok()
        .and_then(|v| v.trim().parse::<u32>().ok())
        .unwrap_or(0)
}

/// RAII depth bump: sets `MODEL_SUBAGENT_DEPTH = prev + 1` for the duration of a sub-turn,
/// restores the previous value on drop (even on panic). Mirrors the agent's `EnvGuard`.
struct DepthGuard {
    prev: Option<String>,
}

impl DepthGuard {
    fn enter(next: u32) -> Self {
        let prev = std::env::var(SUBAGENT_DEPTH_ENV).ok();
        std::env::set_var(SUBAGENT_DEPTH_ENV, next.to_string());
        Self { prev }
    }
}

impl Drop for DepthGuard {
    fn drop(&mut self) {
        match self.prev.take() {
            Some(v) => std::env::set_var(SUBAGENT_DEPTH_ENV, v),
            None => std::env::remove_var(SUBAGENT_DEPTH_ENV),
        }
    }
}

/// Wrap a verb's result value into the `DispatchResult` node shape the caller expects —
/// identical to what the guest's dispatch handler stores, so self and cross-plugin dispatch
/// return the same structure. `reply_ref` is synthetic here (there is no graph round-trip),
/// present only for shape parity.
fn dispatch_result_node(reply_ref: &str, result: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "@id": format!("urn:sovereign:dispatch-result:{reply_ref}"),
        "@type": DISPATCH_RESULT_TYPE,
        REPLY_REF_FIELD: reply_ref,
        RESULT_FIELD: result,
    })
}

/// Run a SELF-dispatched verb on a fresh instance and return the `DispatchResult`-shaped
/// JSON string (the same shape `await_dispatch_result` would have returned). Only `respond`
/// is self-dispatchable today (the delegation verb); any other self-targeted verb is an
/// honest error — a plugin has no other reason to call itself through the dispatch seam.
///
/// Error-neutral (`Result<String, String>`) to match `dispatch_to_plugin`'s contract.
pub(crate) async fn run_self_dispatch(
    cross: &CrossPluginAccess,
    plugin_id: &str,
    verb: &str,
    input: serde_json::Value,
) -> Result<String, String> {
    if verb != "respond" {
        return Err(format!(
            "self-dispatch: plugin '{plugin_id}' can only dispatch 'respond' to itself, not '{verb}'"
        ));
    }

    let depth = current_depth();
    if depth >= MAX_SUBAGENT_DEPTH {
        return Err(format!(
            "self-dispatch: sub-agent nesting limit reached (depth {depth} ≥ {MAX_SUBAGENT_DEPTH}) — refusing to delegate deeper (likely a delegation loop)"
        ));
    }

    let spawner = cross.self_respond.get().ok_or_else(|| {
        "self-dispatch: the runtime did not wire a fresh-instance spawner (no re-entrancy available)".to_string()
    })?;

    // The verb's args ARE the respond payload ({prompt, system?, session_id?, ...}). A
    // sub-turn omitting session_id gets a fresh session (get_or_create_session mints one),
    // so the sub-agent does not pollute the parent's conversation.
    let payload = input.to_string();

    // Bump the nesting depth for the duration of the sub-turn, then run respond on a fresh
    // instance. The guard restores the previous depth when this scope ends.
    let _depth_guard = DepthGuard::enter(depth + 1);
    let respond_json = spawner(plugin_id.to_string(), payload)
        .await
        .map_err(|e| format!("self-dispatch: sub-agent respond failed: {e}"))?;

    // respond returns a JSON string ({content, model, usage}); surface it parsed as the
    // node's `result` so the caller gets structured data — matching the guest handler.
    let result = serde_json::from_str::<serde_json::Value>(&respond_json)
        .unwrap_or_else(|_| serde_json::json!({ "content": respond_json }));
    let reply_ref = format!("self-{plugin_id}-d{depth}");
    Ok(dispatch_result_node(&reply_ref, result).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_self_dispatch_matches_only_identical_nonempty_ids() {
        assert!(is_self_dispatch("agent", "agent"));
        assert!(!is_self_dispatch("agent", "vault"));
        assert!(!is_self_dispatch("", ""), "empty caller id is never self-dispatch");
        assert!(!is_self_dispatch("", "agent"));
    }

    #[test]
    fn dispatch_result_node_has_the_shared_shape() {
        let node = dispatch_result_node("self-agent-d0", serde_json::json!({ "content": "hi" }));
        assert_eq!(node["@type"], DISPATCH_RESULT_TYPE);
        assert_eq!(node[REPLY_REF_FIELD], "self-agent-d0");
        assert_eq!(node[RESULT_FIELD]["content"], "hi");
        assert_eq!(node["@id"], "urn:sovereign:dispatch-result:self-agent-d0");
    }

    #[test]
    fn depth_guard_sets_and_restores() {
        // DepthGuard mutates the process-global SUBAGENT_DEPTH_ENV; take the crate env lane so the
        // set/remove here doesn't data-race the other env-mutating tests under parallel cargo test.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(SUBAGENT_DEPTH_ENV);
        assert_eq!(current_depth(), 0);
        {
            let _g = DepthGuard::enter(1);
            assert_eq!(current_depth(), 1);
            {
                let _g2 = DepthGuard::enter(2);
                assert_eq!(current_depth(), 2);
            }
            assert_eq!(current_depth(), 1, "inner guard restores to outer depth");
        }
        assert_eq!(current_depth(), 0, "outer guard restores to unset");
        assert!(std::env::var(SUBAGENT_DEPTH_ENV).is_err());
    }
}
