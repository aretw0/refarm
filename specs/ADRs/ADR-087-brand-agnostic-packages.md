# ADR-087: Brand-Agnostic Packages — Only the App Owns Its Name

**Status**: Accepted (binary decoupling phases 1-3 implemented + tested; phase 3a tail + phase 4 env-prefix are follow-ons)
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
4. **(phase 2, wider)** Thread `BrandContext.envPrefix` to retire the hardcoded
   `REFARM_…` env keys across the generic packages.
