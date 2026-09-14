# ADR-087: Brand-Agnostic Packages — Only the App Owns Its Name

**Status**: Accepted  
**Progress**: Binary decoupling phases 1-3a DONE + tested; env-prefix phase 4a (the config env-bridge, the structural leak) DONE; phase 6 generalized cross-package source-guard DONE (`release:brand:guard`, allowlist-ratcheted) with `context-provider-v1` and `operator-resume` leaks fixed; remaining: allowlisted injectable defaults (phase-4 survey) + the renderer/contract identifier inventory in phase 6's out-of-scope list  
**Date**: 2026-07-10
**Deciders**: Arthur Silva, Refarm agents
**Related**: ADR-086 (Plugin Vocabulary Convergence — the `plugin` command; its
white-label seam for the bundled set is the sibling of this one), `@refarm.dev/cli`
(`command-handoff`), `apps/refarm`, the white-label doctrine (env-prefix +
rebrandable brand layer)

---

## Context

A doctrine, stated by Arthur: **"só o refarm app que deveria ficar usando a palavra
refarm, o resto deveria ser agnóstico focado na sua função e não em nomes
personalizados."** Only the app that OWNS a brand may use its name; every generic
package must be brand-agnostic — named for its FUNCTION, not for a product.

The codebase violates this. `@refarm.dev/cli` — a generic package — hardcodes the
product name "refarm" in the command handoffs it produces:

- `refarmCommand(args)` = `applicationCommand("refarm", args)` and `refarmProcess`
  (`command-handoff.ts`) — the brand baked into a generic helper, with ~49
  consumers.
- `launch-policy.ts`, `operator-resume.ts`, `rust-substrate.ts` each call
  `applicationCommand("refarm", …)` directly — package code emitting a
  brand-named handoff.

The tell: `applicationCommand(binary, args)` is ALREADY agnostic (the binary is a
parameter). The violation is the `"refarm"` literal supplied INSIDE the package.
So a white-label app "acme" composing refarm's blocks would still emit `refarm
<verb>` in its handoffs — the brand leaks out of the substrate.

(This also corrected an in-flight mistake: migrating hardcoded `"refarm X"`
literals to `refarmCommand(["X"])` CENTRALIZED the brand but did not DECOUPLE it —
the package still knew "refarm". Centralization is necessary but not sufficient.)

There is a second, related dimension (env-prefix `REFARM_…`, hardcoded across
`capability-host`, `config`, `sidecar-client`, …) and a naming-style corollary
(symbols inside `@refarm.dev/capabilities` repeating the `Capability` prefix). The
env-prefix is the same brand-leak at a different layer; the naming style is a
judgment guideline, not a rename sweep (Arthur: "deixamos esses namespaces para
quando faz sentido de verdade").

## Decision

**A brand name lives ONLY in the app that owns it. Generic packages take the brand
as injected context (a `BrandContext`), never as a hardcoded literal. Packages are
named for their function; the app supplies the name.**

### 1. The generic package exposes only the agnostic primitive

`@refarm.dev/cli`'s `command-handoff` keeps `applicationCommand(binary, args)` /
`applicationProcess(binary, args)` — already brand-neutral — and DROPS
`refarmCommand` / `refarmProcess`. The brand-specialized helpers move to
`apps/refarm` (the brand's owner), defined over the agnostic primitive:

```ts
// apps/refarm/src/brand.ts  (the ONE place "refarm" is spoken as a binary)
export const refarmCommand = (args: string[]) => applicationCommand("refarm", args);
export const refarmProcess = (args: string[]) => applicationProcess("refarm", args);
```

The ~49 consumers (all in `apps/refarm`) repoint their import from
`@refarm.dev/cli/command-handoff` to the app-local brand module.

### 2. Package code that must emit a handoff takes the binary as context

The package functions that today call `applicationCommand("refarm", …)` inline
(`launch-policy`, `operator-resume`, `rust-substrate`) either (a) take the binary
as a parameter / small `BrandContext`, or (b) move the brand-named string
construction to the app and receive only the neutral pieces. A `BrandContext` is
the durable shape:

```ts
export interface BrandContext {
  binary: string;        // "refarm" — the CLI name in handoffs
  envPrefix?: string;    // "REFARM" — the env-var namespace (phase 2)
}
```

The app constructs its `BrandContext` once and threads it where a package needs to
name the brand; refarm's is `{ binary: "refarm", envPrefix: "REFARM" }`.

### 3. Phased — the binary first, the env-prefix next

The binary name in handoffs (D1) is the felt pain and the smaller surface (6
points in `packages/cli`). It goes first. The env-prefix (`REFARM_…`, D2) is the
same leak one layer down but far wider (dozens of sites across several packages);
it is sequenced after, threading the same `BrandContext.envPrefix`. Boiling both
at once is rejected — D1 proves the shape, D2 follows.

### 4. Naming style is a guideline, not a sweep

Symbols repeating their package's name (`CapabilityDescriptor` inside
`@refarm.dev/capabilities`) are verbose where the namespace already gives the
context. This is a JUDGMENT guideline applied to NEW code and clear-win cleanups —
NOT a mass rename (68 external consumers; the prefix sometimes aids readability at
the use site). Keep a namespace/prefix when it genuinely disambiguates.

## Consequences

**Enables**
- A white-label app emits ITS binary name in handoffs, not "refarm" — the brand
  stops leaking out of the generic substrate.
- One brand seam (`BrandContext`) to grow: binary now, env-prefix + home paths
  later, all from one injected object.
- `@refarm.dev/cli` becomes honestly agnostic — named for its function.

**Costs / risks**
- Moving `refarmCommand` repoints ~49 imports (all app-local, mechanical, but
  wide). Must stay behavior-identical: `refarmCommand(["x"])` still yields
  `"refarm x"`.
- The 3 package sites emitting brand handoffs need threading — the trickiest part
  (they are package internals, not app code).
- A `BrandContext` that under-scopes (binary only, forever) leaves the env-prefix
  leak; without the tracked phase 2 it half-solves.
- The source-guard must extend to catch a re-introduced brand literal in packages
  (today it only guards `packages/cli/src` for `"refarm <verb>"`; it should also
  fail on `applicationCommand("refarm", …)` inside generic packages).

## Alternatives considered

- **Keep `refarmCommand` in `@refarm.dev/cli`, centralized.** Rejected — Arthur's
  point exactly: centralized ≠ agnostic; the generic package still knows the brand.
- **Full `BrandContext` (binary + env + paths + …) in one pass.** Kept as the
  target shape but sequenced; doing every dimension at once is a large refactor
  that risks the whole white-label surface at once. Binary-first proves it.
- **A build-time rebrand that renames the source (the existing rebrand protocol).**
  Complementary, not a replacement: rebrand renames for distribution; this keeps
  the RUNTIME substrate agnostic so composition (a white-label app importing
  refarm's blocks) works without a source rename.

## Rollout (phased)

1. ✅ **DONE** (35073ea9). Moved `refarmCommand`/`refarmProcess` to
   `apps/refarm/src/brand.ts` over the agnostic `applicationCommand`; repointed ~45
   app consumers; `@refarm.dev/cli` dropped the brand helpers. Behavior-identical.
2. ✅ **DONE** (06ee4824). Threaded the binary through `launch-policy`,
   `operator-resume`, `rust-substrate`: the binary is now REQUIRED (Arthur: "fail
   up" — no `binary="refarm"` fallback). The app injects its own; the RUNTIME_*
   constants + operator-resume handoffs moved to the app; a neutral (brand-free)
   default keeps bare launch-policy calls agnostic.
3. ✅ **DONE** (this commit). Extended the source-guard to also fail on
   `applicationCommand("refarm", …)` inside any generic package, not just the
   `"refarm <verb>"` literal form. ONE tracked exception remains:
   `capability-index-data.ts` — a static reference TABLE of example activation
   commands (docs-like, not runtime handoffs). Its brand parameterization is the
   phase-3 tail; the guard fails on any NEW offender.
   3a. ✅ **DONE** (7e1cf08f). Parameterized `capability-index-data.ts` off `"refarm"`
       (`buildCapabilities(binary)`); the index accessors require the binary and the
       app injects it (a new `REFARM_BINARY` constant in brand.ts). Guard exception
       dropped — **@refarm.dev/cli is now fully brand-agnostic** (zero
       `applicationCommand("refarm")` remains).
4. **(env-prefix, chewed slice by slice)** Retire the hardcoded `REFARM_…` env
   keys across the generic packages. A measured survey found the env-prefix is
   NOT one uniform sweep but three categories with very different value/cost, and
   the *runtime* read-sites in packages are far fewer than the raw literal count:

   - **(a) env→config bridge** — `@refarm.dev/config`'s `EnvSource` read
     `REFARM_SITE_URL / _SCOPE_* / _PROVIDER_* / _GIT_HOST / _REMOTE_TOKEN /
     _EPHEMERAL_SOURCE` from `process.env` with the brand baked in. This is the
     STRUCTURAL leak (maps env → the `brand`/`providers` config tree) and the
     highest-value target.
     4a. ✅ **DONE** (bff0d919). Parameterized off the prefix:
         `envPrefixFromBrand(name)` (mirrors `applicationCommandOverrideEnv`'s
         normalization), `resolveEnvPrefix(explicit, env)` (explicit → neutral
         selector `SOVEREIGN_ENV_PREFIX` → default `"REFARM"`), and an
         `{ envPrefix }` options bag on `loadConfig`/`loadConfigAsync`. Env-prefix
         is the ONE brand dimension with a RESOLVED DEFAULT (per the white-label
         doctrine: "não é 'sempre REFARM' nem 'tira o refarm' — é config
         resolvida"), unlike the CLI binary which fails up. Backward-compatible
         (default `REFARM`); 5 new tests prove an `ACME` prefix reads
         `ACME_SITE_URL / _SCOPE_* / _PROVIDER_*`.

   - **(b) home / identity** — `REFARM_HOME`, the `.refarm/` directory name (~100
     literal sites), `REFARM_VERSION`. Survey finding: this lives OVERWHELMINGLY
     in `apps/refarm` (`refarm-home.ts`, `tractor-store.ts`, `runtime-metadata.ts`,
     `composition-resolver.ts`) — which is CORRECT, the app owns its brand. The
     only package reader is `silo/src/index.js:359` (`REFARM_HOME`). Touching the
     100 `.refarm` app-sites is high-churn / low-value and mostly inside the brand
     owner; NOT worth a sweep. `VITE_REFARM_VERSION` (in `tractor-ts`, `homestead`)
     is a distinct build-time Vite var with a `"0.1.0-solo-fertil"` fallback.

     **Matured 2026-08-01:** the physical default remains app-owned, but the
     directory ROLES are now a brand-agnostic SDK contract. `@refarm.dev/root`
     exposes `sovereignDirectories(absoluteRoot)` and the Refarm app injects
     `REFARM_HOME || ~/.refarm`. Central operator-state consumers use that adapter;
     plugins and generic packages must not derive `.refarm` themselves. This
     preserves existing nodes while allowing a future explicit XDG, Termux, or
     system-service adapter. See `specs/features/sovereign-directory-layout.md`.

   - **(c) per-package tuning knobs** — `REFARM_SIDECAR_URL` (capability-host),
     `REFARM_SIDE_REQUEST_TIMEOUT_MS` (sidecar-client), `REFARM_NAMESPACE` (spawn
     env), `REFARM_LOG_LEVEL`, etc. Survey finding: these are ALREADY injectable
     (`envKey?`, `timeoutEnvVar?` options) with the `REFARM_*` only a DEFAULT
     fallback — a softer leak than (a). Several live in §8-protected surfaces
     (`packages/tractor/**`, `tractor-ts/**`) requiring lock/handoff. Each is a
     1-2-line default of modest individual value.

   Net: (a) is the real prize and is DONE. (b) is mostly app-owned (leave). (c) is
   scattered injectable-defaults, part behind §8 — chew opportunistically where a
   package is touched for another reason, not as a standalone grind.

5. ✅ **DONE** (3a0d36da + 8016e92d). Revealed by the T1 white-label seam
   (`examples/devbench-t1`): the MIRROR of this whole ADR — a generic package
   leaking a DIFFERENT brand. `@refarm.dev/capability-host` hardcoded
   `DEFAULT_HOST_COMMAND_ENV_KEY = "DGK_COMMAND"` (the devbench example's brand),
   so any white-label calling `createHostCommandResolver({ defaultCommand: "acme" })`
   silently got `DGK_COMMAND` as its override env, not `ACME_COMMAND`. Fixed with
   `hostCommandOverrideEnv(command)` (derives `dgk`→`DGK_COMMAND`, mirrors
   `applicationCommandOverrideEnv`); the constant is dropped (nothing published →
   no compat alias). The constructive half (`white-label-config.test.ts`) proves
   phase-4a's env-prefix seam end-to-end from the consumer side: devbench drives
   the shared `@refarm.dev/config` under the `DGK` prefix, zero refarm leak. The
   lesson: a real T1 consumer reveals brand leaks in BOTH directions (refarm →
   example AND example → shared substrate).

6. ✅ **DONE** (this commit). The generalized cross-package source-guard the
   Consequences section called for now exists:
   `scripts/ci/test-brand-agnostic-packages.mjs` (`pnpm run release:brand:guard`)
   walks EVERY `packages/*/src`, strips comments, and fails on a brand string
   literal or `applicationCommand("refarm", …)` outside a surveyed allowlist that
   may only shrink (a ratchet test forces entries out when a file is cleaned).
   Writing the guard immediately caught and fixed two live leaks the cli-only
   guard could not see:
   - `packages/cli/src/operator-resume.ts` filtered pressure commands with
     `startsWith("refarm ")` — a form the cli guard's own regex missed (no verb
     after the space). Fixed by carrying `binary` on `OperatorResumeCommands`.
   - `packages/context-provider-v1` — a kernel-contract publication candidate —
     spawned the branded binary (`operator-state.ts`) and spoke the brand in the
     agent system prompt (`registry.ts`). Both now take an injected identity:
     `buildSystemPrompt(entries, { productName, binary })` (REQUIRED, fail up)
     and `new OperatorStateProvider(binary)`; the app injects
     `REFARM_PRODUCT_NAME`/`REFARM_BINARY` from `brand.ts`.

   **Surveyed remainder (the allowlist, deferred deliberately):** injectable
   defaults (`capabilities/ide-projector.ts` namespace, `infra-*` team names),
   vocabulary ids (`config/workspaces-config.js` workspace kind), an inert
   conformance fixture (`storage-contract-v1`), repo-internal tooling
   (`toolbox/reso.mjs`), and a §8-locked OPFS segment
   (`tractor-ts/opfs-plugin-cache.ts` — change only via lock/handoff).

   **Out of the guard's scope, tracked here instead** (renames change public
   contracts — decide before public publication, not by sweep):
   - `refarm-*` CSS classes / `data-refarm-*` attrs / `--refarm-*` vars across
     renderer SDKs (`authorization-contract-v1/render.ts`,
     `capability-homestead-surface`, `homestead` SDK, `ds/tokens-emit.ts`
     dual selector + exported `RefarmThemeToken`).
   - Served JSON-LD context IRIs `https://refarm.dev/contexts/{authorization,
     credentials,records}/v1` (+ hardcoded copies in `packages/wallet`).
   - Branded contract identifiers: VC type `RefarmConformanceCredential`
     (`credentials-contract-v1/conformance.ts`), DID method `did:refarm-wasm:`
     (`identity-provider-ref`), plugin-id namespace `@refarm/agent` (ADR-086).
   - The Rust twin of the agent prompt (`packages/agent/src/runtime/policy.rs`)
     still says "Refarm runtime agent" — changing it means a wasm rebuild plus
     harness revalidation; take it as its own slice.
