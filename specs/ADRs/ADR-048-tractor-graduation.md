# ADR-048: tractor-native Graduation — Becomes the Canonical `tractor`

**Status**: Accepted
**Date**: 2026-03-19
**Deciders**: Core Team
**Supersedes**: graduation criteria defined in [ADR-047](ADR-047-tractor-native-rust-host.md)
**Related**: [ADR-044](ADR-044-wasm-plugin-loading-browser-strategy.md), [ADR-045](ADR-045-loro-crdt-adoption.md), [ADR-046](ADR-046-refarm-composition-model.md)

---

## Context

`packages/tractor-native` has satisfied all six graduation criteria defined in ADR-047:

| # | Criterion | Verification |
|---|---|---|
| 1 | `cargo test` — all pass | ✅ 52/52 (`--test-threads=1`) |
| 2 | Loro binary interop JS↔Rust | ✅ `loro_binary_js_interop` — fixture from `loro-crdt` JS imported by `loro` Rust |
| 3 | Plugin lifecycle: load/ingest/teardown | ✅ `plugin_lifecycle_setup_teardown` + `plugin_ingest_roundtrip` |
| 4 | TS `.db` readable by `NativeStorage` | ✅ `schema_compat_ts_db_readable` |
| 5 | Binary footprint ≤30 MB | ✅ 27 MB stripped release |
| 6 | All `@refarm.dev/tractor` consumers mapped | ✅ 4 apps + 8 packages — ARCHITECTURE.md |

Criterion #2 (Loro binary interop) was verified without requiring a browser environment:
`packages/sync-loro/scripts/gen-loro-fixture.mjs` produces a binary Loro update using
`loro-crdt` (JS, v1.10.7) with the exact shape of `LoroCRDTStorage.storeNode()`. The 294-byte
fixture is committed to `tests/fixtures/loro-js-update.bin` and verified by a pure Rust unit
test — no Playwright, no subprocess, no browser.

The TypeScript `@refarm.dev/tractor` continues to work in browser/Node.js contexts. This decision
promotes the native host as the canonical implementation while preserving the TS version as a
reference for browser-native deployments.

---

## Decision

**Promote `packages/tractor-native` to `packages/tractor` as the canonical tractor implementation.**

The TypeScript implementation is archived as `packages/tractor-ts` and preserved as the reference
for browser-native (JCO-based) plugin execution.

---

## Migration Plan

### Step 1 — Archive TypeScript implementation

```bash
# In the repo root
mv packages/tractor packages/tractor-ts
# Update packages/tractor-ts/package.json: name → @refarm.dev/tractor-ts
```

### Step 2 — Promote native implementation

```bash
mv packages/tractor-native packages/tractor
# Update packages/tractor/Cargo.toml: name = "tractor"
# Update packages/tractor/package.json (if any): name → @refarm.dev/tractor
```

### Step 3 — Update consumers (12 packages)

**4 applications:**
- `apps/homestead` — `import { Tractor } from '@refarm.dev/tractor'` stays the same (path changes)
- `apps/farmhand` — `import { Tractor }` → may be deprecated if replaced by native daemon
- `apps/studio` — `import { Tractor }`
- `apps/refarm-me` — `import { Tractor }`

**8 packages:**
- `packages/sync-loro` — `BrowserSyncClient` already speaks the wire protocol; no changes needed
- `packages/storage-sqlite` — schema is unchanged; no consumer path changes needed
- `packages/tractor-ts` — archived, consumers updated to use `@refarm.dev/tractor-ts` explicitly
  if they need JCO-based browser execution
- Remaining packages: update path aliases in `tsconfig.json` / `package.json` workspaces

### Step 4 — CI/CD adjustments

- Rename `cargo test -p tractor-native` → `cargo test -p tractor` in all workflows
- No version bumps: all packages remain at `0.1.0` (none published yet)
- Update `packages/tractor/docs/ROADMAP.md` header references
- Update `roadmaps/MAIN.md` section header

---

## Rollback

If the native host exposes regressions in a consumer, `packages/tractor-ts` is preserved at
`packages/tractor-ts` with full history. Consumers can temporarily pin to `@refarm.dev/tractor-ts`
while the native host is fixed.

---

## Consequences

### Positive
- Single canonical `@refarm.dev/tractor` — no longer split between `tractor` (TS) and
  `tractor-native` (Rust) in documentation and tooling
- IoT / Electron targets get a first-class package name
- `BrowserSyncClient` and all consumers that speak the Loro wire protocol require zero changes

### Negative / trade-offs
- Consumers that rely on browser-native JCO execution must explicitly reference `tractor-ts`
- `cargo component` toolchain required for plugin compilation (pre-existing requirement)
- Migration is a rename — no API changes — but requires a coordinated PR touching 12 consumers

### Neutral
- All WIT contracts unchanged — `.wasm` plugins built for `tractor-ts` run on `tractor` without recompilation
- `.db` files portable between browser sessions and native daemon (criterion #4 proven)
- Binary CRDT format identical between `loro-crdt` JS and `loro` Rust (criterion #2 proven)

---

## References
- [ADR-047 — tractor-native Native Rust Plugin Host](ADR-047-tractor-native-rust-host.md)
- `packages/tractor-native/docs/ARCHITECTURE.md` — consumer map and graduation strategy
- `packages/tractor-native/tests/conformance.rs` — all graduation criteria as executable tests
- `packages/sync-loro/scripts/gen-loro-fixture.mjs` — JS-side fixture generator for criterion #2
