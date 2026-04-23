# Barn/Tractor installPlugin flow audit (2026-04-23)

## Scope

Task: `T-PLUGIN-01`  
Goal: map the real install/cache/verify flow across Barn + Tractor, identify risk points, and produce a hardening plan before implementation tasks (`T-PLUGIN-02`, `T-PLUGIN-03`).

---

## Current flow map (as implemented)

### 1) Barn package (`@refarm.dev/barn`)

Source: `packages/barn/src/index.ts`

1. `installPlugin(url, integrity)` validates integrity format (`sha256-*`).
2. Fetches plugin bytes on cache miss (`_cacheByUrl` in-memory).
3. Computes SHA-256 digest and validates against expected digest.
4. Stores cached binary in memory map (`_cacheByUrl`).
5. Registers inventory entry in memory (`_inventory`) with random `urn:refarm:plugin:*` id.

**Observed:** integrity enforcement exists, but persistence is process-local (no OPFS, no durable catalog).

### 2) Tractor browser helper (`@refarm.dev/tractor`)

Sources:
- `packages/tractor-ts/src/lib/install-plugin.ts`
- `packages/tractor-ts/src/lib/opfs-plugin-cache.ts`
- `packages/tractor-ts/src/index.browser.ts`

1. `installPlugin(manifest, wasmUrl)` checks OPFS cache by `manifest.id`.
2. On miss (or force), fetches wasm bytes.
3. If `manifest.integrity` exists, verifies SHA-256.
4. Stores raw `.wasm` bytes in OPFS (`refarm-plugins/<safe-plugin-id>.wasm`).
5. Returns metadata (`cached`, `byteLength`).

**Observed:** browser `PluginHost` still throws on `load()` (stub), so install cache is not consumed by runtime load yet.

### 3) Tractor runtime host (Node path)

Source: `packages/tractor-ts/src/lib/plugin-host.ts`

1. `PluginHost.load(manifest)` fetches from `manifest.entry` (or reads `file://`).
2. Instantiates via runner path.
3. Calls `setup()`.

**Observed:** runtime load path bypasses Barn and OPFS install cache completely.

### 4) Tractor native host (Rust)

Source: `packages/tractor/src/host/plugin_host/env_and_runtime.rs`

1. Loads wasm from local path.
2. Validates manifest/runtime alignment when adjacent manifest is present.
3. Calls setup through structured lifecycle telemetry boundary.

**Observed:** alignment checks are present (T-RUNTIME-10), but this is independent from browser install/cache flow.

---

## Risk map

| Risk | Severity | Evidence | Impact |
|---|---|---|---|
| Barn and Tractor expose parallel install flows with different storage semantics | High | `packages/barn/src/index.ts` vs `packages/tractor-ts/src/lib/install-plugin.ts` | Divergent behavior and duplicated security surface |
| Browser runtime cannot load from installed cache yet | High | `packages/tractor-ts/src/index.browser.ts` stub throws on `load()` | Install does not complete lifecycle (install ≠ executable) |
| Integrity validation is optional in tractor-ts path (`manifest.integrity` absent) | ~~Medium~~ Resolved | (historical) `if (manifest.integrity) { ... }` in `install-plugin.ts` | ✅ Mitigated: `.wasm` install now fails without `manifest.integrity`; cache hit is revalidated before reuse |
| OPFS layout differs from Barn docs (`refarm-plugins/*` vs `/refarm/barn/*`) | Medium | `opfs-plugin-cache.ts` vs `packages/barn/docs/STORAGE_LAYOUT.md` | Operational confusion + migration overhead |
| No shared contract test proving install→cache hit/miss→runtime load | Medium | separate tests (`barn/tests`, `tractor-ts/test/install-plugin.test.ts`) | Regressions can pass package-local tests |

---

## Hardening plan (generated from this audit)

### P0 — integrity and cache correctness

1. **T-PLUGIN-02** ✅: hash verification mandatory in install pipeline; malformed/absent digest now blocks `.wasm` installation.
2. **T-PLUGIN-03** ✅: regression tests cover cache miss/hit + tamper recovery (cache mismatch triggers eviction + refetch).

### P1 — single installation contract

3. **T-PLUGIN-04 (new)**: unify Barn + Tractor installation contract (shared cache/index abstraction + canonical OPFS layout) and document ownership boundaries.

### P2 — runtime execution from installed cache

4. Implement browser runtime load path backed by installed cache (close ADR-044 steps 3→4 with executable flow).

---

## Validation evidence used in this mapping

- `packages/barn/src/index.ts`
- `packages/barn/tests/integration.test.ts`
- `packages/tractor-ts/src/lib/install-plugin.ts`
- `packages/tractor-ts/src/lib/opfs-plugin-cache.ts`
- `packages/tractor-ts/src/lib/plugin-host.ts`
- `packages/tractor-ts/src/index.browser.ts`
- `packages/tractor/src/host/plugin_host/env_and_runtime.rs`
- `specs/ADRs/ADR-044-wasm-plugin-loading-browser-strategy.md`
