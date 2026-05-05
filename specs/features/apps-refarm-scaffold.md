# Feature: apps/refarm Scaffold — CLI Distro Binary

**Status**: In Progress
**Version**: v0.1.0
**Owner**: Arthur Silva

---

## Summary

Creates `apps/refarm` as the canonical CLI binary for the Refarm distro, separating the binary entrypoint from the `packages/cli` library. Migrates all 7 existing commands from `packages/cli` to `apps/refarm` using a TDD gate (tests before move), and adds the first headless-native command: `refarm status --json`, which boots an ephemeral Tractor instance to report real runtime and trust state.

---

## User Stories

**As a** Refarm developer
**I want** `refarm status --json` to output a stable JSON contract
**So that** I can script and integrate host state checks without parsing human output

**As a** Refarm contributor
**I want** `packages/cli` to be a library-only package
**So that** I can import `buildRefarmStatusJson` without pulling in a CLI binary

---

## Acceptance Criteria

1. **Given** a working Refarm install
   **When** I run `refarm status --json`
   **Then** stdout is valid JSON matching the `RefarmStatusJson` schema with `schemaVersion: 1`

2. **Given** `refarm status --json` output
   **When** `runtime.ready` is checked
   **Then** it reflects whether Tractor booted successfully

3. **Given** `packages/cli`
   **When** imported as a library
   **Then** it has no `bin` entrypoint, no commander dependency, no command implementations

4. **Given** all 7 existing commands
   **When** migrated to `apps/refarm`
   **Then** their existing tests pass and each command has at least one new unit test

---

## Technical Approach

**High-level design:**

```
packages/trust    ──┐
packages/runtime  ──┤──→ packages/cli (library only)
packages/homestead──┘           │
                                ↓
                          apps/refarm (binary)
                          + packages/tractor
                          + chalk, commander, inquirer
```

**Status command — headless Tractor probe:**

Boots an ephemeral `Tractor` (in-memory storage, no sync, `logLevel: "silent"`) to extract real `RuntimeSummary` and `TrustSummary`, then calls `buildRefarmStatusJson` and outputs JSON or a human-readable summary.

**Adapter functions (new, in domain packages):**

- `packages/runtime`: `createRuntimeSummaryFromTractor(tractor): RuntimeSummary`
- `packages/trust`: `createTrustSummaryFromTractor(tractor): TrustSummary`

**Migration strategy:** TDD gate per command — write test, copy implementation, delete source, verify green.

**Key decisions:**
- Adapters live in domain packages to keep `apps/refarm` free of extraction logic
- Headless probe (ephemeral Tractor) over Farmhand daemon query — no daemon dependency
- `packages/cli` loses `bin`, `commander`, `inquirer` after migration

---

## API/Interface

```typescript
// packages/runtime (new export)
export function createRuntimeSummaryFromTractor(tractor: Tractor): RuntimeSummary

// packages/trust (new export)
export function createTrustSummaryFromTractor(tractor: Tractor): TrustSummary

// apps/refarm/src/commands/status.ts
export const statusCommand: Command  // --json flag, boots ephemeral Tractor
```

---

## Test Coverage

**Unit tests (TDD):**

- [ ] `createRuntimeSummaryFromTractor` — ready:true after boot, namespace matches config
- [ ] `createTrustSummaryFromTractor` — profile and zero counts for fresh Tractor
- [ ] `statusCommand --json` — output matches `RefarmStatusJson` shape; `schemaVersion: 1`
- [ ] `init` — creates `refarm.config.json` with correct shape
- [ ] `sow` — stores secrets in Silo; no secrets leak to stdout
- [ ] `guide` — generates `SETUP_GUIDE.md` with expected sections
- [ ] `health` — returns healthy/unhealthy based on mock checks
- [ ] `migrate` — runs migration without error; dry-run writes nothing
- [ ] `deploy` — dry-run produces expected log without calling Windmill
- [ ] `plugin` — list/install/remove sub-commands trigger correct registry calls

---

## Implementation Tasks

**SDD:**

- [x] Define `TrustSummary`, `RuntimeSummary`, `buildRefarmStatusJson` contracts
- [x] Write feature spec

**TDD:**

- [ ] `createRuntimeSummaryFromTractor` tests in `packages/runtime`
- [ ] `createTrustSummaryFromTractor` tests in `packages/trust`
- [ ] `statusCommand` tests in `apps/refarm`
- [ ] One test per migrated command in `apps/refarm`

**DDD:**

- [ ] Scaffold `apps/refarm` (package.json, tsconfigs, vitest.config.ts)
- [ ] Implement `createRuntimeSummaryFromTractor`
- [ ] Implement `createTrustSummaryFromTractor`
- [ ] Migrate `init` (test → move → gate)
- [ ] Migrate `sow` (test → move → gate)
- [ ] Migrate `guide` (test → move → gate)
- [ ] Migrate `health` (test → move → gate)
- [ ] Migrate `migrate` (test → move → gate)
- [ ] Migrate `deploy` (test → move → gate)
- [ ] Migrate `plugin` (test → move → gate)
- [ ] Add `status` command (test → implement → gate)
- [ ] Strip `packages/cli` to library-only
- [ ] Smoke gate: all workspaces green

---

## References

- [refarm-status-package-contracts.md](../../docs/proposals/refarm-status-package-contracts.md)
- [REFARM_STATUS_OUTPUT.md](../../docs/REFARM_STATUS_OUTPUT.md)
- [ADR-008](../ADRs/ADR-008-ecosystem-technology-boundary.md)
