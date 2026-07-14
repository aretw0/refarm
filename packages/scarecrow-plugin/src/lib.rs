#[allow(warnings)]
mod bindings;

use std::cell::RefCell;

use bindings::exports::plugin::host::integration::{Guest as IntegrationGuest, PluginMetadata};
use bindings::plugin::host::tractor_bridge;
use bindings::plugin::host::types::PluginError;

/// The Scarecrow — a SANDBOXED host-effect observer. It declares `observe-host-effects`
/// (see plugin.json), so the tractor host forwards every `host-effect:*` event (fs read/
/// write/edit, shell spawn) to this plugin via `on_event`. The plugin records each effect
/// with a risk VERDICT and stores it as a node the host can read back — the tamper-evidence
/// governance trail, produced by a plugin that is ITSELF the least-privileged citizen: its
/// world imports only `tractor-bridge` (no fs/shell/net), so the governor cannot do the very
/// things it governs. "The policy that governs extensions is itself a sandboxed extension."
struct Scarecrow;

/// The node `@type` the observer stores its verdicts under — a caller reads them back with
/// query-nodes to see what the sandboxed auditor witnessed.
const OBSERVATION_TYPE: &str = "ScarecrowObservation";

// A running count of observed effects, so each observation node has a stable, unique id
// within a session (the host store overwrites same-id nodes).
thread_local! {
    static SEQ: RefCell<u64> = const { RefCell::new(0) };
}

/// The declared risk of a host effect, from the same low/medium/high vocabulary the
/// platform's permission model uses (fs:read=low, fs:write=medium, fs:edit=medium,
/// shell:spawn=high). An unrecognised effect is `high` — fail-closed.
fn risk_of_effect(event: &str) -> &'static str {
    // event is `host-effect:<permission>`; classify by the permission tail.
    match event.strip_prefix("host-effect:").unwrap_or(event) {
        "fs:read" => "low",
        "fs:write" | "fs:edit" => "medium",
        "shell:spawn" => "high",
        _ => "high",
    }
}

/// The verdict for an observed effect. High-risk effects are FLAGGED for review; the rest
/// are noted. A real deployment would gate on a policy profile; here the observer records
/// the decision so a reviewer sees governance happening in-sandbox. Pure — unit-tested.
fn verdict_for(event: &str) -> (&'static str, &'static str) {
    let risk = risk_of_effect(event);
    let verdict = if risk == "high" { "flagged" } else { "noted" };
    (risk, verdict)
}

/// Build the observation node for a host effect: its type, a unique id, the effect event,
/// the acting plugin (from the payload if present), and the risk + verdict.
fn build_observation_node(seq: u64, event: &str, payload: Option<&str>) -> serde_json::Value {
    let (risk, verdict) = verdict_for(event);
    let plugin_id = payload
        .and_then(|p| serde_json::from_str::<serde_json::Value>(p).ok())
        .and_then(|v| v.get("plugin_id").and_then(|p| p.as_str()).map(str::to_string));
    serde_json::json!({
        "@id": format!("urn:sovereign:scarecrow-observation:{seq}"),
        "@type": OBSERVATION_TYPE,
        "effect": event,
        "risk": risk,
        "verdict": verdict,
        "pluginId": plugin_id,
    })
}

impl IntegrationGuest for Scarecrow {
    fn setup() -> Result<(), PluginError> {
        tractor_bridge::emit_telemetry("scarecrow:ready", None);
        Ok(())
    }
    fn ingest() -> Result<u32, PluginError> {
        Ok(0)
    }
    fn push(_payload: String) -> Result<(), PluginError> {
        Ok(())
    }
    fn teardown() {}
    fn get_help_nodes() -> Result<Vec<String>, PluginError> {
        Ok(vec![])
    }
    fn metadata() -> PluginMetadata {
        PluginMetadata {
            name: "scarecrow".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            description:
                "Sandboxed host-effect observer: records every fs/shell effect a plugin performs, with a risk verdict — the governor is itself a least-privileged extension."
                    .to_string(),
            supported_types: vec![OBSERVATION_TYPE.to_string()],
            required_capabilities: vec!["tractor-bridge".to_string()],
        }
    }
    fn on_event(event: String, payload: Option<String>) {
        // The host forwards `host-effect:*` events here (this plugin declares
        // observe-host-effects). Anything else is ignored.
        if !event.starts_with("host-effect:") {
            return;
        }
        let seq = SEQ.with(|s| {
            let mut n = s.borrow_mut();
            *n += 1;
            *n
        });
        let node = build_observation_node(seq, &event, payload.as_deref());
        let _ = tractor_bridge::store_node(&node.to_string());
    }
    fn respond(_payload: String) -> Result<String, PluginError> {
        Err(PluginError::NotPermitted(
            "scarecrow observes; it does not respond".to_string(),
        ))
    }
}

bindings::export!(Scarecrow with_types_in bindings);

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
