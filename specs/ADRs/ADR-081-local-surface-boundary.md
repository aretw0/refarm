# ADR-081: Local Surface Boundary

**Status**: Proposed
**Date**: 2026-07-03
**Deciders**: Arthur Silva, Refarm agents
**Related**: ADR-016 (Headless UI Contract), ADR-042 (Homestead Modularization),
ADR-056 (Unified Refarm Host Boundary), ADR-072 (Consumer Leaf Distribution
Policy), `specs/features/2026-07-03-local-surface-v1.md`,
`packages/local-surface`, `packages/ds`, `packages/homestead`,
`packages/dispatch-surface`

---

## Context

The T2 PoC pressure needs a local-first browser-facing flow that can be launched
by a white-label CLI and shown as a simple local platform. Existing Refarm
surfaces cover adjacent but different jobs:

- `@refarm.dev/ds` owns tokens, theme CSS, static HTML helpers, and UI quality
  checks.
- `@refarm.dev/homestead` owns the richer browser SDK and operating
  environment.
- `@refarm.dev/dispatch-surface` owns transport/control-plane routes and
  capability-gated dispatch helpers.

Calling the new block `local-web-shell` would blur two boundaries: "shell" is
already used for runtime/process and Homestead concepts, and "web" would make a
single adapter sound like the core abstraction. The reusable need is smaller and
more neutral: a local-first surface manifest that can render to HTML, carry a
launch plan, and expose quality evidence without owning provider adapters or a
runtime host.

## Decision

We will keep the lightweight T2 block as `@refarm.dev/local-surface` with
capability `local-surface:v1`.

The package owns:

- a provider-neutral `refarm.local-surface.v1` manifest;
- DS-backed static HTML rendering over `@refarm.dev/ds/html`;
- a white-label launch plan for CLI/TUI/Web wrappers;
- deterministic `quality:v1` report helpers using `@refarm.dev/ds/quality-checker`.

The package does not:

- start an HTTP server;
- persist data;
- choose a provider;
- own product routes, screenshots, branding, or final UX;
- replace Homestead;
- extend `dispatch-surface` transport/control semantics.

It remains a candidate package until a downstream consumer proves the package is
needed in a release handoff.

## Alternatives Considered

### Add the surface to `@refarm.dev/ds`

**Pros:**

- Reuses the package that already owns HTML helpers and quality checks.

**Cons:**

- Makes DS own product/application manifest semantics.
- Risks turning a design-system helper package into an app shell package.

### Add the surface to `@refarm.dev/homestead`

**Pros:**

- Homestead already owns the rich browser operating environment.

**Cons:**

- Pulls a heavier runtime closure into simple POC/demo consumers.
- Blurs the line between a static local-first surface packet and a full browser
  SDK.

### Add the surface to `@refarm.dev/dispatch-surface`

**Pros:**

- Dispatch surfaces already model external control paths.

**Cons:**

- Local UI manifest/rendering is not transport or effort dispatch.
- Would mix operator/control-plane concerns with presentational local-first
  surface evidence.

### Create `@refarm.dev/local-web-shell`

**Pros:**

- Describes the first motivating adapter directly.

**Cons:**

- "Shell" collides with Homestead and runtime/process language.
- "Web" overfits the adapter and hides CLI/TUI wrapping.

### Chosen: `@refarm.dev/local-surface`

**Rationale**: It names the reusable abstraction rather than the first rendering
adapter. The package can stay small, testable, and product-neutral while
Homestead, DS, and dispatch-surface keep their existing responsibilities.

## Consequences

**Positive:**

- T2 can show a local-first platform flow without depending on Homestead.
- Consumers get a white-label launch plan and quality evidence shape.
- The package can graduate into `vault-seed-ready` only after downstream proof.

**Negative:**

- Another package exists in the surface layer.
- Consumers must still provide a concrete server/CLI wrapper when they want to
  run the generated document.

**Risks:**

- The package could grow into a second Homestead. Mitigation: keep boundaries in
  tests and docs; no runtime host, storage provider, or provider adapter inside
  `local-surface`.
- The package could be selected too early. Mitigation: do not tag it
  `vault-seed-ready` until a consumer proof exists.

## Implementation

**Affected components:**

- `packages/local-surface`
- `packages/README.md`
- `packages/README-CAPABILITIES.md`
- `packages/DISTRIBUTION_STATUS.md`
- `docs/superpowers/plans/2026-07-03-poc-release-convergence-matrix.md`

**Validation:**

- `pnpm --filter @refarm.dev/local-surface run test`
- `pnpm --filter @refarm.dev/local-surface run type-check`
- `pnpm --filter @refarm.dev/local-surface run lint`
- `pnpm --filter @refarm.dev/local-surface run build`
- `pnpm run local-surface:docs:test`

## References

- `packages/local-surface/README.md`
- `docs/POC_DEMONSTRATION_PACKET.md`
- `docs/superpowers/plans/2026-07-03-poc-release-convergence-matrix.md`
