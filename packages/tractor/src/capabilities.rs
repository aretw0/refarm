/// Stable capability strings declared in plugin manifests (`capabilities.provides`).
///
/// These are the contracts between plugin authors and the tractor host.
/// The tractor uses them to route events and select the active agent without
/// coupling to specific plugin names.

/// Plugin can receive agent-tool (agent-fs/agent-shell) observation events
/// via `integration.on-event`. Used by observer routing in `observer.rs`.
pub const CAP_OBSERVE_AGENT_TOOLS: &str = "observe-agent-tools";

/// Plugin implements the `integration.respond` export and can handle
/// user prompts. The tractor uses this to identify the active agent and
/// route efforts to it. Multiple plugins may declare this capability;
/// the first loaded takes precedence.
pub const CAP_AGENT_RESPOND: &str = "agent:respond";
