# ADR-012: Hybrid Model Routing Strategy for Pi Agent Harness

**Status**: Proposed  
**Date**: 2026-04-22  
**Deciders**: Tractor/Pi-Agent maintainers  
**Related**: [ADR-013](ADR-013-testing-strategy.md), [ADR-047](ADR-047-tractor-native-rust-host.md), [ADR-048](ADR-048-tractor-graduation.md), [ADR-049](ADR-049-post-graduation-horizon.md), ISS-012

---

## Context

The current Tractor host already enforces strict boundary hardening for agent execution (`LLM_SHELL_ALLOWLIST`, `LLM_FS_ROOT`, env/header sanitization, trusted plugin gates). However, model/provider selection remains largely implicit and provider-specific.

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

**We will introduce a host-side deterministic `ModelRouter` for Pi Agent harness execution, with explicit capability mapping and policy profiles.**

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
- Pi Agent harness integration path (`packages/tractor/tests/pi_agent_harness.rs`)
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
- `packages/tractor/src/host/wasi_bridge/llm_http_and_headers.rs`
