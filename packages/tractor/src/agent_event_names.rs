//! Canonical `agent:*` event NAMES — the tractor-side mirror of the contract the agent
//! guest emits (`packages/agent/src/agent_events.rs`). The host consumes these by name
//! (audit routing, the agent→activity bridge), so pinning them here as named constants
//! keeps the cross-crate string contract in one place instead of scattered literals.
//!
//! These MUST stay in lockstep with the agent's `EVENT_*` constants; a fixture/e2e test
//! (the observer's live tests already assert `agent:route:selected` etc.) catches drift.

pub(crate) const PROMPT_START: &str = "agent:prompt:start";
pub(crate) const ITERATION: &str = "agent:iteration";
pub(crate) const TOOL_CALL: &str = "agent:tool:call";
pub(crate) const RESPONSE_DONE: &str = "agent:response:done";
pub(crate) const ERROR: &str = "agent:error";
pub(crate) const BUDGET_BLOCKED: &str = "agent:budget:blocked";
pub(crate) const BUDGET_UNKNOWN: &str = "agent:budget:unknown";
pub(crate) const ROUTE_SELECTED: &str = "agent:route:selected";
