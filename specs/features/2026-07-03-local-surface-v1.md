# Feature: Local Surface v1 (`local-surface:v1`)

**Status**: Implemented candidate
**Version**: v0.1.0 candidate
**Owner**: Refarm package lane

---

## Summary

`local-surface:v1` defines a provider-neutral local-first surface packet for
consumer POCs and downstream products. It generates a manifest, static DS-backed
HTML, a white-label launch plan, and a `quality:v1` report without owning a
server, storage adapter, provider integration, or Homestead runtime.

---

## User Stories

**As a** downstream POC author
**I want** a small local-first surface manifest that can be rendered and
quality-checked
**So that** I can demo a local web flow without depending on a product-specific
app shell.

**As a** package maintainer
**I want** the local surface boundary separated from DS, Homestead, and dispatch
**So that** each package keeps a defensible responsibility.

---

## Acceptance Criteria

1. **Given** a local surface manifest input
   **When** the package creates a manifest
   **Then** the result uses `refarm.local-surface.v1`, declares
   `local-surface:v1`, records local-only storage namespaces, and declares that
   network is not required.

2. **Given** a local surface manifest
   **When** the package renders a document
   **Then** the HTML uses `@refarm.dev/ds/html`, escapes consumer data, and
   emits action attributes that a white-label host can wire up.

3. **Given** a local surface manifest
   **When** the package builds a launch plan
   **Then** the plan has `doctor`, `render`, `serve`, and `handoff` steps while
   keeping concrete server binding downstream-owned.

4. **Given** a local surface manifest
   **When** the package runs quality checks
   **Then** the report uses `quality:v1` over the DS quality checker adapter.

5. **Given** the `vault-seed-ready` handoff selection
   **When** release readiness is checked
   **Then** `@refarm.dev/local-surface` selected in `vault-seed-ready` after downstream proof.

---

## Technical Approach

**High-level design:**

- Package: `packages/local-surface`
- Capability: `local-surface:v1`
- Manifest schema: `refarm.local-surface.v1`
- Rendering dependency: `@refarm.dev/ds/html`
- Quality dependency: `@refarm.dev/ds/quality-checker` over
  `@refarm.dev/quality-contract-v1`

**Data flow:**

1. Consumer constructs a `LocalSurfaceInput`.
2. `createLocalSurfaceManifest` normalizes the route base and local-first
   storage declaration.
3. `renderLocalSurfaceDocument` emits static HTML using DS helpers.
4. `buildLocalSurfaceLaunchPlan` emits white-label CLI/TUI/Web host steps.
5. `checkLocalSurfaceQuality` emits a `quality:v1` report from a deterministic
   DS lint snapshot.

**Key decisions:**

- ADR-081 records why this is a standalone package.
- The package is a candidate and is deliberately not in `vault-seed-ready`.
- The first rendering adapter is HTML, but the abstraction is "surface", not
  "web shell".

---

## API/Interface

```typescript
export const LOCAL_SURFACE_SCHEMA = "refarm.local-surface.v1";
export const LOCAL_SURFACE_CAPABILITY = "local-surface:v1";

export interface LocalSurfaceManifest {
  schema: typeof LOCAL_SURFACE_SCHEMA;
  capability: typeof LOCAL_SURFACE_CAPABILITY;
  id: string;
  title: string;
  description: string;
  routeBase: string;
  theme: string;
  localFirst: {
    mode: "local-only";
    storageNamespaces: string[];
    networkRequired: false;
  };
  panels: LocalSurfacePanel[];
  actions: LocalSurfaceAction[];
  evidence: string[];
  boundaries: string[];
}
```

Primary helpers:

- `createLocalSurfaceManifest(input)`
- `renderLocalSurfaceDocument(manifest, options)`
- `buildLocalSurfaceLaunchPlan(manifest, options)`
- `buildLocalSurfaceQualityProfile()`
- `createLocalSurfaceQualitySnapshot(manifest)`
- `checkLocalSurfaceQuality(manifest, profile)`

---

## Test Coverage

**Unit tests:**

- [x] Manifest local-first shape and boundaries.
- [x] DS-backed HTML rendering and escaping.
- [x] White-label launch plan shape.
- [x] `quality:v1` report through DS checker.

**Documentation/selection tests:**

- [x] ADR/spec/package docs share the same boundary vocabulary.
- [x] `vault-seed-ready` does not include `@refarm.dev/local-surface`.

---

## Implementation Tasks

- [x] Implement package.
- [x] Add package README.
- [x] Document package registry and capability boundary.
- [x] Add ADR-081.
- [x] Add this feature spec.
- [x] Add docs test.
- [x] Add downstream proof before selecting in `vault-seed-ready`.

Downstream proof received (2026-07-03): the official `vault-seed` checkout consumed a packed candidate tarball, built a local-first operator manifest, rendered DS HTML, emitted a white-label `dgk` launch plan, and validated the `quality:v1` report while keeping routes, screenshots, provider adapters, and product vocabulary downstream. Selection still waits for the next `vault-seed-ready` release-lane refresh.

---

## References

- [ADR-081](../ADRs/ADR-081-local-surface-boundary.md)
- [PoC release convergence matrix](../../docs/superpowers/plans/2026-07-03-poc-release-convergence-matrix.md)
- [PoC demonstration packet](../../docs/POC_DEMONSTRATION_PACKET.md)
