# ADR-012: Hybrid Model Routing Strategy for Agent Harness

**Status**: Proposed — **Decision revised 2026-07-13** (locus corrected: router lives in the agent, not the host; see the Revision block below)
**Date**: 2026-04-22 (original) · 2026-07-13 (revision)
**Deciders**: Tractor/Agent maintainers
**Related**: [ADR-013](ADR-013-testing-strategy.md), [ADR-047](ADR-047-tractor-native-rust-host.md), [ADR-048](ADR-048-tractor-graduation.md), [ADR-049](ADR-049-post-graduation-horizon.md), **[ADR-059](ADR-059-tractor-rust-authoritative-runtime.md)** (post-dates this ADR and reframes the host/orchestrator boundary), ISS-012

---

## Revision (2026-07-13): the router belongs in the agent, not the host

> This ADR was written **2026-04-22**, *before* ADR-059 fixed the Tractor
> boundary ("the Rust host stays imperative; the orchestrator/guest owns
> translation and policy"). Its original **Decision** — a **host-side**
> `ModelRouter` — is superseded by the reality that grew in the tree and by
> ADR-059. This block records the corrected decision; the original Context /
> Decision / Alternatives below are kept verbatim as the historical record.

**Verified in source (2026-07-13):** provider/model selection and fallback
**already live in the agent (WASM guest)**, and there is **no** `ModelRouter` in
`packages/tractor/src/host/*`:

- `packages/agent/src/session/pure.rs` — `provider_name_from_env()`:
  `MODEL_PROVIDER` → `MODEL_DEFAULT_PROVIDER` → `ollama` floor (agrees with the
  host env-unset `ModelRoute` default, so a zero-config run resolves end-to-end).
- `packages/agent/src/provider_config.rs` — `choose_model()` (explicit vs
  default) and `openai_compat_defaults()` (per-provider base_url + default model).
- `packages/agent/src/runtime/wasm_flow.rs` — `run_wasm_react_with_prompt_ref_and_route()`
  (route override → env → default), `run_primary_completion()`, and
  `try_fallback_completion()` (`MODEL_FALLBACK_PROVIDER` / `MODEL_FALLBACK_MODEL_ID`),
  each gated by the per-provider spend guard `budget_exceeded_for_provider()` /
  `sum_provider_spend_usd()` and emitting `agent_events::budget_blocked` / `error`.
- The host's only routing role is boundary resolution + sanitization
  (`wasi_bridge/core.rs` `ModelRoute` env-default; header/env hardening). The
  `profile` type in `host/plugin_registry.rs` is the **plugin capability
  profile** (provides/subscribes), *not* model routing.

**Corrected decision:** the model router **stays in the agent**. This is where
the logic already lives, it is native-testable as pure functions, and it is
coherent with ADR-059 ("host imperative, guest owns policy") and with the
doctrine audit in this lineage (do not overload the host; the agent is a
forcing-function citizen, not a privileged special case — see
`memory/agent-como-control-plane.md` and the load_skill/update_plan audit).

**What is actually missing** (the ADR's real intent, minus the wrong locus) —
this is the remaining work, all agent-side:

1. **Capability map** per provider/model (chat / tool-call / structured-JSON /
   embedding / context-window / cost tier) — today `openai_compat_defaults`
   only maps base_url + a default model id; there is no declared capability
   metadata to route *by*.
2. **Routing profiles** `cheap | balanced | reliable` — today routing is a flat
   override→env→default resolution; there is no named intent that picks a
   provider/model *by capability + cost* rather than by explicit id.
3. **Auditable decision trail** — the fallback path already emits
   `agent_events::budget_blocked`/`error`, but there is no record of *which*
   route was chosen and *why* (selected route, profile, fallback reason, budget
   pressure) as a first-class event/node.

The mechanics the original ADR fretted about (deterministic fallback chain,
bounded fallback depth, budget gating) **already exist** and are correct; they
did not need a host router. Implementation of (1)-(3) is deferred to a focused
follow-up and should extend the existing pure functions in
`provider_config.rs` / `session/pure.rs`, surfacing the audit trail through the
existing `agent_events` telemetry (the same channel `budget_blocked`/`error`
already use), so an observer sees route decisions like any other agent event.

---

## Context

> _Below this line is the original 2026-04-22 proposal, kept verbatim as the
> historical record. Read it through the lens of the Revision block above: the
> problem statement still holds, but the chosen locus (host-side) does not._

The current Tractor host already enforces strict boundary hardening for agent execution (`MODEL_SHELL_ALLOWLIST`, `MODEL_FS_ROOT`, env/header sanitization, trusted plugin gates). However, model/provider selection remains largely implicit and provider-specific.

This creates three problems:

1. **Capability mismatch risk**: different providers/models have different support for tool-calling, JSON reliability, latency/cost profile, and quota behavior.
2. **Operational drift**: policy decisions (fallbacks, retry behavior, route preference) are spread across session/runtime tooling instead of a deterministic host-side contract.
3. **Governance gap**: model routing should be auditable and composable with existing security boundaries, not treated as ad-hoc UI/session logic.

Constraints:

- Keep host boundaries fail-closed.
- Preserve local-first operation and deterministic behavior.
- Avoid breaking existing plugin contracts.
- Support incremental rollout (no big-bang migration).

---

## Decision

**We will introduce a host-side deterministic `ModelRouter` for agent harness execution, with explicit capability mapping and policy profiles.**

The router contract will include:

- **Capability map** per provider/model (e.g. chat, tool-call, structured JSON, embedding).
- **Routing profiles**: `cheap`, `balanced`, `reliable`.
- **Deterministic fallback chain** when selected route is unavailable/quota-blocked.
- **Pre-model governance gates** integrated with existing host hardening.
- **Auditable decision trail** (selected route, fallback reason, budget pressure signal).

Security remains unchanged in principle: model routing happens **after** environment/header/host boundary sanitization, and cannot bypass `trusted_plugins` or spawn/fs guards.

---

## Alternatives Considered

### Option 1: Keep routing in session/UI logic only
**Pros:**

- Fastest to ship.
- No host changes.

**Cons:**

- Non-deterministic across runtimes.
- Hard to audit and test as an invariant.
- Higher policy drift risk.

### Option 2: Hardcode a single provider/model
**Pros:**

- Very simple.
- Predictable in stable environments.

**Cons:**

- Poor resilience under quota/outage.
- No cost/performance tuning profile.
- Capability mismatch becomes runtime failure.

### Option 3: Host-side deterministic ModelRouter (chosen)
**Pros:**

- Deterministic and testable.
- Composable with existing host security boundaries.
- Supports explicit budget/capability governance.

**Cons:**

- More implementation surface.
- Requires ongoing capability-map maintenance.

### Chosen: Option 3
**Rationale**: Aligns with Tractor's sovereign host model (policy in host, not scattered runtime behavior), while preserving incremental rollout and compatibility.

---

## Consequences

**Positive:**

- Routing decisions become reproducible and auditable.
- Better quota/cost resilience with deterministic fallback.
- Reduced provider-specific coupling in higher layers.

**Negative:**

- Additional policy surface to maintain.
- Requires discipline to keep capability metadata current.

**Risks:**

- Capability map staleness (mitigation: test fixtures + scheduled policy review).
- Overly aggressive fallback loops (mitigation: bounded fallback depth + explicit failure states).
- Hidden policy regressions (mitigation: dedicated router unit/integration tests in host).

---

## Implementation

**Affected components:**

- `packages/tractor/src/host/*` (routing policy + integration hooks)
- Agent harness integration path (`packages/tractor/tests/agent_harness.rs`)
- Session/runtime policy plumbing for route profiles and budget signals
- Documentation (`specs/ADRs/README.md`, Tractor docs as needed)

**Migration path:**

1. Introduce router primitives and typed policy config behind feature-safe defaults.
2. Add capability-map fixtures and deterministic route tests.
3. Wire policy profiles (`cheap|balanced|reliable`) and fallback semantics.
4. Add auditing/telemetry fields for route decisions.
5. Flip default to router-backed path after test and compatibility gate passes.

**Timeline**: Start in current hardening phase; promote to default after passing targeted host + harness validation gates.

---

## References

- `packages/tractor/src/host/sensitive_aliases.rs`
- `packages/tractor/src/host/agent_tools_bridge/core.rs`
- `packages/tractor/src/host/plugin_host/core.rs`
- `packages/tractor/src/host/wasi_bridge/model_http_and_headers.rs`
