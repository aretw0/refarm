# Feature: Barn Gate 2 - Plugin Ecosystem Hardening

**Status**: Draft - ready for implementation
**Version**: v0.1.x gate completion
**Owner**: Barn + Tractor package lane

---

## Summary

Gate 3 proved browser <-> daemon pairing and OPFS-backed `installPlugin()` behavior through `@refarm.dev/tractor`. The next unfinished front is Gate 2: move from single-path install proofs to ecosystem-grade plugin lifecycle ownership in `@refarm.dev/barn` (hot-swap mileage, persistent inventory semantics, and deterministic lifecycle behavior).

This spec defines the implementation packet so the next contributor can execute without additional research.

---

## Scope and Boundary

**In scope**:

- [ ] Define Barn-owned public lifecycle contract (`installPlugin`, `loadPlugin`, `listPlugins`, `uninstallPlugin`) with stable error taxonomy.
- [ ] Add Barn test suites for integrity rejection, cache revalidation, and uninstall cleanup.
- [ ] Add inventory persistence semantics (explicitly defined source of truth and reconciliation behavior).
- [ ] Prove 3-plugin hot-swap flow in `apps/me` without restart.
- [ ] Keep `packages/tractor-ts/src/lib/install-plugin.ts` as compatibility seam while Barn ownership converges.

**Out of scope**:

- [ ] New plugin discovery protocols, registries, or Nostr transport changes.
- [ ] New runtime engine contracts (`plugin-manifest` shape changes).
- [ ] Release publication policy and npm promotion decisions.

---

## User Stories

**As a** daily-driver operator
**I want** plugin install/load/uninstall to be deterministic and auditable under Barn ownership
**So that** plugin extensibility is reliable enough for Gate 2 completion.

**As a** package maintainer
**I want** a single lifecycle boundary instead of duplicated install logic spread across packages
**So that** future hardening happens in one place.

---

## Acceptance Criteria

1. **Given** a valid plugin URL + integrity hash
   **When** `Barn.installPlugin()` runs on cache miss
   **Then** bytes are fetched, integrity-verified, cached, and inventory state is persisted as installed.

2. **Given** a cached plugin
   **When** `Barn.installPlugin()` runs without force
   **Then** cached bytes are revalidated before reuse, and corrupted cache is evicted then refetched.

3. **Given** an invalid or tampered artifact
   **When** installation is attempted
   **Then** Barn returns a typed integrity failure and no partial cache/inventory state remains.

4. **Given** an installed plugin
   **When** `Barn.uninstallPlugin()` runs
   **Then** cache + inventory entries are removed and the next load attempt fails with not-installed semantics.

5. **Given** three plugins in sequence
   **When** `apps/me` executes install -> load -> uninstall flows in one session
   **Then** no restart is required and all lifecycle transitions are observable by smoke evidence.

---

## Technical Approach

**High-level design:**

- Keep canonical byte validation through `installWasmArtifact` from `@refarm.dev/plugin-manifest`.
- Consolidate Barn lifecycle API in `packages/barn/src/index.ts`.
- Introduce Barn-side persistence boundary for inventory state.
- Keep `tractor-ts` install path as adapter/compatibility layer until migration is complete.

**Key decisions:**

- ADR-044 remains the browser install strategy anchor.
- Gate 3 remains done; this packet is Gate 2 completion work.
- Barn ownership should converge without breaking existing `apps/me` smoke coverage.

---

## API/Interface

```typescript
export interface BarnLifecycle {
  installPlugin(url: string, integrity: string, options?: { pluginId?: string; force?: boolean }): Promise<PluginEntry>;
  loadPlugin(pluginId: string): Promise<ArrayBuffer>;
  listPlugins(): Promise<PluginEntry[]>;
  uninstallPlugin(pluginId: string): Promise<void>;
}

export type BarnInstallErrorCode =
  | "integrity-mismatch"
  | "integrity-missing"
  | "fetch-failed"
  | "cache-corrupted"
  | "not-installed";
```

---

## Traceability Matrix (SDD -> BDD -> TDD -> DDD)

| Requirement / Decision | SDD source | BDD test file | TDD test file | DDD implementation |
| --- | --- | --- | --- | --- |
| Cache miss install with integrity | this spec | `packages/barn/test/install-plugin.contract.test.ts` | `packages/barn/test/install-plugin.unit.test.ts` | `packages/barn/src/index.ts` |
| Cache hit revalidation + eviction | ADR-044 + this spec | `packages/barn/test/install-plugin.contract.test.ts` | `packages/barn/test/cache-adapter.unit.test.ts` | `packages/barn/src/index.ts` |
| Uninstall cleanup | this spec | `packages/barn/test/uninstall.contract.test.ts` | `packages/barn/test/inventory.unit.test.ts` | `packages/barn/src/index.ts` |
| 3-plugin hot-swap in app | Gate 2 objective | `apps/me/scripts/smoke-plugin-cache.mjs` (+ new 3-plugin fixture) | `apps/me/test/*` where needed | `apps/me` + `packages/barn` |

---

## Test Coverage

**Integration tests (BDD):**

- [ ] Barn install contract on cache miss/hit/tamper paths.
- [ ] Barn uninstall contract guarantees no partial residue.
- [ ] `apps/me` smoke proving 3-plugin hot-swap without restart.

**Unit tests (TDD):**

- [ ] Integrity error taxonomy and mapping.
- [ ] Cache adapter behavior under corrupted entries.
- [ ] Inventory persistence/reconciliation behavior.

---

## Implementation Tasks

**SDD:**

- [ ] Freeze Barn lifecycle API and error-code vocabulary.
- [ ] Decide inventory persistence location and conflict policy.

**BDD:**

- [ ] Add Barn contract tests (install/revalidate/reject/uninstall).
- [ ] Extend `apps/me` smoke to cover 3-plugin hot-swap.

**TDD:**

- [ ] Add unit tests for cache and inventory internals.
- [ ] Add unit tests for typed error mapping.

**DDD:**

- [ ] Implement Barn lifecycle ownership in `packages/barn/src/index.ts`.
- [ ] Keep `tractor-ts` compatibility seam while callers migrate.

---

## Execution Plan (Red -> Green)

**Gate 1 (SDD ready):**

- [ ] API + error taxonomy approved
- [ ] No TODO/TBD in critical sections

**Gate 2 (BDD red):**

- [ ] `pnpm -C packages/barn test -- test/install-plugin.contract.test.ts test/uninstall.contract.test.ts` fails from missing behavior
- [ ] `pnpm -C apps/me run smoke:plugin-cache` fails when the 3-plugin hot-swap scenario is added

**Gate 3 (TDD red):**

- [ ] `pnpm -C packages/barn test -- test/install-plugin.unit.test.ts test/cache-adapter.unit.test.ts test/inventory.unit.test.ts` fails from missing internals

**Gate 4 (DDD green):**

- [ ] `pnpm -C packages/barn test` passes
- [ ] `pnpm -C packages/barn build` passes
- [ ] `pnpm -C packages/tractor-ts test -- test/install-plugin.test.ts` passes (compatibility)
- [ ] `pnpm -C apps/me run smoke:plugin-cache && pnpm -C apps/me run smoke:content-plugin && pnpm -C apps/me run smoke:real-daemon-roundtrip` passes

**Evidence commands:**

- BDD red: `pnpm -C packages/barn test -- test/install-plugin.contract.test.ts test/uninstall.contract.test.ts`
- TDD red: `pnpm -C packages/barn test -- test/install-plugin.unit.test.ts test/cache-adapter.unit.test.ts test/inventory.unit.test.ts`
- Green/full verify: `pnpm -C packages/barn test && pnpm -C packages/barn build && pnpm -C packages/tractor-ts test -- test/install-plugin.test.ts && pnpm -C apps/me run smoke:plugin-cache && pnpm -C apps/me run smoke:content-plugin && pnpm -C apps/me run smoke:real-daemon-roundtrip`

---

## References

- `docs/v0.1.0-release-gate.md`
- `docs/gate3-homestead-tractor-spec.md`
- `roadmaps/MAIN.md`
- `packages/barn/ROADMAP.md`
- `specs/ADRs/ADR-044-wasm-plugin-loading-browser-strategy.md`
