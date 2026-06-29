# Decision Log

Central register for high-impact technical decisions that are pending or recently accepted.

## Consumer leaf distribution policy

**Date**: 2026-06-29
**Status**: Accepted
**ADR**: [ADR-072](../specs/ADRs/ADR-072-consumer-leaf-distribution-policy.md)
**References**: `@refarm.dev/ds/html`, `@refarm.dev/process-handoff`, [docs/ECOSYSTEM_SUPPLY_MAP.md](ECOSYSTEM_SUPPLY_MAP.md), [docs/NAMING_REGISTRY.md](NAMING_REGISTRY.md)

**Decision**: reusable consumer-pulled leaves stay under the lightest correct domain. A parent
subpath is acceptable only when it does not pull unrelated install closure, license posture, runtime
dependencies, or release cadence.

**Homestead/DS outcome**: the build-free HTML helpers are DS-owned and canonical at
`@refarm.dev/ds/html`. `@refarm.dev/homestead-ssr` and `@refarm.dev/homestead/ssr` were removed
pre-publication so new consumers do not inherit compatibility vocabulary.

**Process outcome**: `@refarm.dev/process-handoff` must not collapse into `@refarm.dev/cli`. The
preferred breaking rename is `@refarm.dev/process-handoff`, because the package models tokenized
process specs, runner adaptation, detached execution, and artifact/provenance handoffs.

Note: tree-shaking alone does **not** prune installed dependencies. A single fat package with regular
`dependencies` on the heavy tier still pulls the whole closure on install, and build-free consumers
have no bundler pruning. The decoupling has to be package/subpath/peer-dep shaped.

**Explicitly NOT candidates** (separation is justified — do not merge these into subpaths):
- the `*-contract-v1` family (~17 pkgs) — independently versioned (`:v1` is the point; a single
  package would force a shared version);
- `storage-*` (`memory`/`rest`/`sqlite`), `sync-*` (`crdt`/`loro`), `*-stream-transport` — a
  contract plus *swappable* implementations with heavy native/WASM deps; separate install is the
  whole point.

---

## `ds/html` documentHtml naming (consumer signal — accepted)

**Date**: 2026-06-29
**Status**: Accepted (consumer signal — vault-seed, follow-up to ADR-072)
**References**: [ADR-072](../specs/ADRs/ADR-072-consumer-leaf-distribution-policy.md), `@refarm.dev/ds/html`

**Signal**: ADR-072 correctly moved the build-free DS HTML helpers to `@refarm.dev/ds/html`
(cohesion — the emitters and the CSS that styles their `ds-*` classes are one contract; splitting
them across packages is what risks drift). But `@refarm.dev/ds/html` exported `shellHtml`, and
"shell" is the word ADR-072 reserves for Homestead (*"Homestead owns runtime/shell/studio
integration"*). The object is right in DS — it is a pure, build-free static HTML document that only
links the DS stylesheets and sets the theme — but the NAME overloads "shell" and can read as
Homestead's live app shell.

**Decision**: rename `ds/html`'s `shellHtml` → `documentHtml` — a static DS-wired HTML document —
keeping "shell" for Homestead's runtime shell. Small and pre-publication; keeps the
DS↔Homestead boundary crisp. Guardrail: keep `ds/html` strictly presentational (string emitters
only); if framework renderers arrive later, mirror the subpath convention (`ds/react`, …) with
`ds/html` as the build-free variant.

No compatibility alias is kept because this surface is still pre-publication and the old name
preserves the ambiguity ADR-072 is removing.

---

## Documentation Canonical Layering

**Date**: 2026-06-17
**Status**: Accepted
**References**: [specs/features/dispatch-control-plane-contract.md](../specs/features/dispatch-control-plane-contract.md), [docs/ARCHITECTURE.md](ARCHITECTURE.md)

**Decision**: Documentation for stable contracts and architectural decisions should use:

- `specs/features/*.md` (feature contracts and implementation targets)
- `specs/ADRs/*.md` (decisão de arquitetura de impacto)
- `docs/ARCHITECTURE.md` / `docs/WORKFLOW.md` (operational and subsystem context)

`docs/superpowers/**` remains a planning/experimental space and should not be treated as the canonical source of long-lived decisions.

---

## Workspace Namespace Policy: Centralized Defaults with Declared Exceptions

**Date**: 2026-06-28
**Status**: Accepted
**ADR**: [ADR-071](../specs/ADRs/ADR-071-workspace-namespace-policy.md)

**Decision**: Refarm-owned local state defaults to `.refarm/`, reviewed project policy lives in
`refarm.config.json`, and additional root-level namespaces such as `.project/`, `.pi-lens/`, or
plugin-owned directories must be declared with owner, purpose, persistence, and access posture.

**What this means now**:
- `.project/` remains a compatibility namespace for Pi-style workflow handoffs, not the semantic
  center of Refarm.
- The Refarm coding agent should use `.refarm/agents/`, `.refarm/sessions/`, `.refarm/handoff/`,
  and `.refarm/runtime/` rather than a new root directory.
- Future `health/check` hardening should audit undeclared namespace drift before broad
  publication.

---

## Daemon Runtime Role: Tractor Node is Canonical, Farmhand is Transitional

**Date**: 2026-04-13
**Status**: Accepted
**References**: [ADR-048](../specs/ADRs/ADR-048-tractor-graduation.md), [ADR-049](../specs/ADRs/ADR-049-post-graduation-horizon.md)

**Decision**: The canonical daemon runtime is the `tractor` node (`ws://localhost:42000`).
`apps/farmhand` remains only as a transitional compatibility layer until CLI, docs, and plugin routing
are fully converged on Tractor terminology and flows.

**What this means now**:
- User-facing docs and commands should reference "Tractor node" as the default daemon.
- `apps/farmhand` can remain in-repo temporarily to preserve migration continuity.
- No deprecation note is required in the main README; track migration via internal docs and ADR lineage.

**Exit criteria to retire Farmhand**:
- CLI commands and messages no longer reference Farmhand.
- Release/docs flows are fully aligned with Tractor node and Pi node language.
- Plugin lifecycle paths (discover, load, route, execute) validated end-to-end under Tractor runtime.

---

## Composition Model: Blocks and Distros

**Date**: 2026-03-17
**Status**: Accepted
**ADR**: [ADR-046](../specs/ADRs/ADR-046-refarm-composition-model.md)

**Decision**: Establish an explicit two-layer architecture. `packages/` are philosophy-neutral
blocks that any developer can use to build any type of application (centralized, hybrid, or
sovereign). `apps/` are opinionated distros that carry Refarm's sovereign philosophy. Blocks
never assume local-first; distros are free to be as opinionated as needed.

**New block**: `@refarm.dev/storage-rest` — first block explicitly targeting centralized apps.
Implements `StorageAdapter` by proxying to any REST API. Proves that Tractor works as a plugin
host for traditional web applications without requiring CRDT or P2P.

**Dogfood rule**: Every Refarm distro must be buildable entirely from Refarm blocks.

**Impact**:
- `specs/ADRs/ADR-046-refarm-composition-model.md` created
- `docs/ARCHITECTURE.md` updated with Composition Model section
- `packages/storage-rest/` created as `@refarm.dev/storage-rest`
- No breaking changes to any existing package

---

## CRDT Engine: Loro replaces Yjs

**Date**: 2026-03-17
**Status**: Accepted
**ADR**: [ADR-045](../specs/ADRs/ADR-045-loro-crdt-adoption.md)
**Supersedes**: [ADR-003 (Yjs)](../specs/ADRs/ADR-003-crdt-synchronization.md)
**Implements**: [ADR-028 (CRDT-SQLite convergence)](../specs/ADRs/ADR-028-crdt-sqlite-convergence-strategy.md)

**Decision**: Adopt `loro-crdt` (Rust-core + WASM) as the CRDT engine. Implement the CQRS
pattern from ADR-028: `LoroDoc` as the write model (source of truth), SQLite as the materialized
read model (projected by a `Projector` that listens to `LoroDoc.subscribe`).

**Key advantages over Yjs**: `LoroTree` with concurrent-move cycle detection, shallow snapshots
for RPi/IoT targets, built-in time travel, single npm package for browser and daemon (no separate
provider ecosystem), Rust-core correctness.

**Impact**:
- New package: `@refarm.dev/sync-loro` — the **only** package that depends on `loro-crdt`
- `apps/farmhand/`: wired with `LoroCRDTStorage`; WebSocket transport changed to binary (`Uint8Array`)
- `packages/homestead/`: `BrowserSyncClient` added for browser ↔ farmhand sync
- `packages/sync-crdt/`: preserved as conceptual reference, no longer in production sync path
- Zero breaking changes to `StorageAdapter`, `SyncAdapter`, or plugin contracts

---

## Sprint 1 Readiness Status

**Date**: 2026-03-07  
**Phase**: Semana 0 → Sprint 1 SDD  
**Overall Status**: 🟢 **READY** (preparation complete)

### Pre-Sprint 1 Blockers

| Blocker | Requirement | Current State | Timeline |
|---------|-------------|---------------|----------|
| WASM Browser Runtime | Validate Rust plugin runs in browser + calls tractor-bridge | ✅ Compilation OK, ⚠️ Runtime untested | ~30 min (test now) |
| OPFS Persistence | Validate wa-sqlite + OPFS performance in browser | ✅ Node benchmark done, ⚠️ Browser pending | ~1-2h (test now) OR defer to Sprint 1 pre-BDD |

**Pragmatic Decision Matrix**:

- ✅ WASM + ✅ OPFS → **GO**: Start Sprint 1 immediately
- ✅ WASM + ⚠️ OPFS (defer) → **GO with caveat**: Add OPFS as Sprint 1 pre-BDD gate
- ✅ WASM + ❌ OPFS → **PAUSE**: Research alternatives (1w)
- ❌ WASM → **PIVOT**: Architecture redesign needed (2+ weeks)

**Recommendation**: Execute WASM validation now (~30 min), then decide on OPFS based on available time.

### What's Been Completed (2026-03-06)

✅ **Documentation consolidation**: Single source of truth established

- `docs/pre-sprint-checklist.md` → canonical Semana 0 readiness reference
- `roadmaps/MAIN.md` → synchronized with current status
- Smoke tests seeded in critical workspaces (tractor, storage-sqlite, sync-crdt)

✅ **Quality gates validated**: CI/test pipeline operational

- Root scripts: `test:unit`, `test:integration`, `test:e2e` ✓
- Turbo tasks aligned ✓
- Changeset workflow configured ✓

✅ **Deliverables prepared**:

- Sprint 1 SDD checklist created
- 5 feature specs ready (Session, Storage Tiers, Migration, Plugin, Schema)
- ADR-015 (SQLite) documented with provisional status

### References

- Detailed checklist: [pre-sprint-checklist.md](pre-sprint-checklist.md)
- Roadmap: [../roadmaps/MAIN.md](../roadmaps/MAIN.md)
- SQLite decision: [../specs/ADRs/ADR-015-sqlite-engine-decision.md](../specs/ADRs/ADR-015-sqlite-engine-decision.md)
- WASM validation: [../docs/research/wasm-validation.md](../docs/research/wasm-validation.md)

---

## In Progress

| Topic | ADR | Owner | Status | Due | Evidence |
|---|---|---|---|---|---|
| WASM + WIT capability enforcement | Validation 3 | Core | In progress | 2026-03-08 | docs/research/wasm-validation.md |

---

## Recently Accepted

| Topic | ADR | Date | Notes |
|---|---|---|---|
| Monorepo structure and boundaries | ADR-001 | 2026-03-06 | Turborepo + workspaces |
| Offline-first architecture | ADR-002 | 2026-03-06 | Storage -> Sync -> Network |
| CRDT choice (Yjs) | ADR-003 | 2026-03-06 | Benchmark-backed decision |
| OPFS persistence strategy | ADR-009 | 2026-03-06 | Vault layout and quota handling |
| JSON-LD schema evolution strategy | ADR-010 | 2026-03-06 | Lens-based upcasting and compatibility guarantees documented |
| Testing strategy (unit/integration/e2e) | ADR-013 | 2026-03-06 | Vitest + Playwright + Changesets strategy documented |
| SQLite engine choice (wa-sqlite vs sql.js) | ADR-015 | 2026-03-13 | Accepted; WASM+WIT lifecycle and Node bench verified |
| Native browser permissions as proxy capabilities | ADR-029 | 2026-03-07 | Capabilities as superset of browser native permissions |
| Astro type-checking in pre-push hooks | (inline) | 2026-03-09 | Added `astro check` to homestead lint/type-check; tsc does not verify `.astro` files |
| Rust WASM plugin compilation in CI | (inline) | 2026-03-09 | Added Rust toolchain + WASM build steps to test.yml and granular-tests.yml; JCO integration tests require pre-compiled plugin binary |

---

## Usage

- Update this file whenever a decision changes state (`Planned`, `In progress`, `Accepted`, `Rejected`).
- Link the final ADR file and supporting benchmark/checklist evidence.
- Keep this log lightweight: one row per decision.
