# ADR-066: TypeScript/Turbo Build Boundary and Package Scaffold Invariants

**Status**: Accepted
**Date**: 2026-05-17
**Deciders**: Arthur Silva
**Related**: ADR-001 (monorepo structure), ADR-030 (devops)

---

## Context

The canonical tsconfig migration (May 2026) unified 56 packages under a shared `buildable.json`/`build.json` preset pattern. During hardening, clearing the turbo cache revealed a class of latent TypeScript errors that had been masked. The root cause was an unclear boundary between:

1. What TypeScript (`tsc`) enforces about file scope and resolution
2. What Turbo enforces about build ordering and output caching

When these responsibilities were conflated in tsconfig configs, errors accumulated silently until cache was invalidated.

**Problems discovered:**
- `composite: true` in dev tsconfigs caused TS6059/TS6307 by making `tsc --noEmit` follow root-tsconfig `paths` (pointing to `src/`) into sibling packages — outside `rootDir`
- Build tsconfigs inherited the same path overrides, causing build-mode tsc to also follow sibling `src/` files
- Source-only packages exporting `./src/index.ts` directly caused TS6059 in consumers' build tsconfigs
- Missing explicit `rootDir` caused TS5011 in TypeScript 6+ whenever `outDir` is set
- `apps/dev` project references broke (TS6306) when `composite: true` was removed globally

---

## Decision

**We separate TypeScript and Turbo responsibilities with a clear two-mode tsconfig architecture.**

### TypeScript is responsible for:
- Type checking (TS errors about types, signatures, compatibility)
- Declaration emit (`.d.ts` generation in `dist/`)
- Enforcing `rootDir` boundaries (which source files belong to which package)
- Project references (`references: []` for IDE incremental builds) — requires `composite: true`

### Turbo is responsible for:
- Build ordering (`^build` dependency graph derived from `package.json` dependencies)
- Output caching (hash inputs, skip when outputs unchanged)
- Parallelization of independent tasks

### Package scaffold invariants (every new buildable package must have):

#### 1. `tsconfig.json` (dev tsconfig — used by IDE and `tsc --noEmit`)
```json
{
  "extends": ["../../tsconfig.json", "@refarm.dev/tsconfig/buildable.json"],
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "baseUrl": "../.."
  },
  "include": ["src/**/*"]
}
```
**Exception**: packages that import workspace packages listed in root `tsconfig.json` `paths` must use `rootDir: ".."` (packages/) instead of `"src"`. This allows the IDE to follow path overrides (which point to sibling `src/`) without TS6059. Current packages requiring this: any package importing `@refarm.dev/stream-contract-v1`.

#### 2. `tsconfig.build.json` (build tsconfig — used by `tsc --project tsconfig.build.json`)
```json
{
  "extends": ["./tsconfig.json", "@refarm.dev/tsconfig/build.json"],
  "compilerOptions": {
    "rootDir": "src"
  },
  "exclude": ["src/**/*.test.ts"]
}
```
The `build.json` preset provides `composite: true`, `paths: {}`, `emitDeclarationOnly: false`. The `paths: {}` is critical — it clears all inherited path overrides so TypeScript resolves `@refarm.dev/*` imports via node_modules to `dist/*.d.ts` during build, never to sibling `src/` files.

#### 3. `package.json` exports
```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "type-check": "tsc --noEmit"
  }
}
```
**Never** use `"main": "./src/index.ts"` or `"exports": "./src/index.ts"` for buildable packages. A package exporting its `.ts` source causes TS6059 in every consumer's build tsconfig (consumer's `rootDir: "src"` rejects the sibling `.ts` file).

#### 4. Build order registration
Add the package to `TASK_SMOKE_TS_BUILD_ORDER` in `scripts/ci/subprocess-utils.mjs` in correct dependency order. The `task:build-order:check` pre-push hook enforces this.

#### 5. Rust/WASM packages: per-package `turbo.json`
```json
{
  "$schema": "https://turbo.build/schema.json",
  "extends": ["//"],
  "tasks": {
    "build": {
      "inputs": ["src/**/*.rs", "wit/**", "Cargo.toml", "Cargo.lock"],
      "outputs": ["dist/**"]
    }
  }
}
```
Without this, turbo emits `WARNING: no output files found for task X#build`. WASM packages must copy artifacts to `dist/` in their build script. Native binary packages can use `outputs: []`.

---

## Alternatives Considered

### A. Keep `composite: true` in `buildable.json` (dev preset)
**Rejected.** `composite` in dev tsconfigs makes `tsc --noEmit` follow root-tsconfig paths into sibling `src/` directories, causing TS6059 for every package that imports a workspace package listed in root `paths`. Massively increases false positives.

### B. Keep `composite: true` in `buildable.json`, add `rootDir: ".."` to all packages
**Rejected.** Changing `rootDir` to `".."` in build tsconfigs breaks the `outDir` structure (emitted files would appear at `dist/package-name/src/` instead of `dist/`).

### C. Remove `composite: true` entirely (no project references)
**Rejected.** `apps/dev` uses TypeScript project references (`references: []`) for incremental IDE type-checking. Removing `composite` from all `tsconfig.build.json` breaks TS6306 for `apps/dev`. Project references require `composite: true` in the referenced project.

### D. Use `paths: {}` in dev tsconfigs too
**Rejected.** Would break IDE go-to-definition — developers would navigate to `dist/*.d.ts` instead of source `.ts` files. The split (dev uses paths → src, build uses `paths: {}` → dist) is intentional.

---

## Consequences

**Positive:**
- Turbo cache can now be fully cleared without revealing hidden type errors
- Dev mode (IDE/type-check) and build mode are cleanly separated
- New packages follow a predictable, verifiable scaffold pattern
- The `validate-scaffold` CI job and `tsconfig:guard` pre-push hook enforce invariants

**Negative:**
- More files per package (dev tsconfig + build tsconfig + per-package turbo.json for Rust)
- Source-only packages that need to be consumed by buildable packages must be upgraded to buildable (add `tsconfig.build.json` + build script)
- The `rootDir: ".."` exception for packages importing root-tsconfig-pathed packages adds a non-obvious variation to the scaffold pattern

**Ongoing maintenance:**
- When adding a new package to root `tsconfig.json` `paths`, audit all its consumers — they may need `rootDir: ".."` in their dev tsconfig
- When changing a package from source-only (exports `src/*.ts`) to buildable, rebuild all consumers with `--force` to verify no hidden TS6059 errors
- After any tsconfig preset change, run `pnpm turbo run build --force` to verify no cached failures
