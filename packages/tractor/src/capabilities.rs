//! Stable capability strings declared in plugin manifests (`capabilities.provides`).
//!
//! These are the contracts between plugin authors and the tractor host.
//! The tractor uses them to route events and select the active agent without
//! coupling to specific plugin names.

/// Plugin can receive host-effect (host-fs/host-shell) observation events
/// via `integration.on-event`. Used by observer routing in `observer.rs`.
pub const CAP_OBSERVE_HOST_EFFECTS: &str = "observe-host-effects";

/// Plugin can receive AGENT lifecycle events (`agent:*` — prompt:start, iteration,
/// tool:call, response:done, error, budget:blocked) via `integration.on-event`.
/// The agent narrates its run through host telemetry; the observer (`observer.rs`)
/// routes those events, by the `agent:` prefix, to any plugin that declared THIS —
/// distinct from `observe-host-effects` so an audit observer and a run-tracer are
/// separate opt-ins. The host never names the observer; it only checks the capability.
pub const CAP_OBSERVE_AGENT_EVENTS: &str = "observe-agent-events";

/// Plugin implements the `integration.respond` export and can handle
/// user prompts. The tractor uses this to identify the active agent and
/// route efforts to it. Multiple plugins may declare this capability;
/// the first loaded takes precedence.
pub const CAP_INTEGRATION_RESPOND: &str = "integration:respond";
