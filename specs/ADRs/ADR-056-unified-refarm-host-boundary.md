# ADR-056: Unified `refarm` Host Boundary (Distro-Owned Host, Block-Owned Primitives)

## Status

**Accepted**

## Context

Refarm currently has multiple product surfaces (`apps/dev`, `apps/me`, `apps/farmhand`,
`apps/refarm`) and strong reusable runtime blocks in `packages/*`.

DEC-031/032/033 already aligned product direction:

- Refarm should converge to one logical host (`refarm`) with renderer modes
  (Web, headless, future TUI), not disconnected products.
- The product CLI/host lives in `apps/` as a distro.
- Reusable mechanics stay in `packages/`.

What remained ambiguous was the **host boundary**: which responsibilities must
belong to the product host versus package primitives and renderer surfaces.

Without this boundary, we risk either:

- pushing product policy into reusable blocks, or
- duplicating runtime/trust/action logic across renderers.

## Decision

Adopt a **unified host boundary** with the following rule:

> The installable `refarm` host is a distro in `apps/refarm`; packages expose
> reusable host/runtime contracts and adapters; renderers are interchangeable
> views over the same host state and actions.

### Host-owned responsibilities (`apps/refarm`)

- bootstrap runtime identity/storage/sync/Tractor;
- choose renderer mode (`web`, `headless`, future `tui`);
- apply product defaults/profiles and operational policy;
- orchestrate trust/reporting summaries for users and automation;
- expose command UX (`refarm status`, `refarm ask`, etc.).

### Block-owned responsibilities (`packages/*`)

- capability contracts (`*-contract-v1`) and conformance;
- runtime primitives (Tractor host/plugin machinery);
- renderer descriptor vocabulary (`@refarm.dev/homestead/sdk/host-renderer`);
- trust/registry/plugin-manifest mechanics;
- stream/telemetry data structures and transport adapters.

### Renderer contract constraints

Renderers **must not** re-own plugin loading, trust policy, or runtime execution.
They can own presentation and modality-specific interaction:

- Web: routes/layout/browser composition;
- headless: machine-readable output;
- TUI (future): terminal interaction model.

## Consequences

### Positive Consequences

- One canonical runtime posture across Web/headless/TUI.
- Clear ownership: product policy in `apps/`, reusable mechanics in `packages/`.
- Lower duplication risk for trust gates, action routing, and telemetry.
- Easier incremental delivery: headless and Web can mature before TUI extraction.

### Negative Consequences

- `apps/refarm` becomes the integration point with broader coupling pressure.
- More discipline required to prevent convenience leaks across boundaries.

## Alternatives Considered

- **Keep app-specific host logic per surface.**
  Rejected: multiplies drift in trust/action/runtime semantics.

- **Move `refarm` CLI product to `packages/` as a neutral block.**
  Rejected: CLI product choices (defaults, UX, release posture) are not neutral.

- **Introduce TUI as first-class host mode immediately.**
  Deferred: adds modality complexity before Web/headless contract is fully stable.

## References

- [ADR-046: Refarm Composition Model](ADR-046-refarm-composition-model.md)
- [DEC-031/032/033 in project decisions](../../.project/decisions.json)
- [Refarm Host Model](../../docs/REFARM_HOST_MODEL.md)
- [Refarm CLI Distro Plan](../../docs/REFARM_CLI_DISTRO.md)
- [Refarm Status Output](../../docs/REFARM_STATUS_OUTPUT.md)
