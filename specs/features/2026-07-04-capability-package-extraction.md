# Built-in capability extraction — the descriptor/domain boundary

**Status:** Reconnaissance done (workflow `wf_17b50ade-b64`, 5 agents source-verified). The plan to let farmhand/apps/me import + project the built-in capabilities — with the decisive finding that **no consumer exists yet**.

## The decisive finding (reorients the HTTP plant)

**Extract extension-review ONLY. Do NOT extract skill/model now.** Verified in source:
- **No consumer exists.** farmhand imports no `@refarm.dev/cli` and has zero `CapabilityDescriptor`/`createCapabilityRegistry` usage (its "capabilities" are plugin-manifest provides/requires). apps/me uses cli only for capability-index + project-automations. The premise "so farmhand + apps/me can import them" is a future *want*, not a present need — extracting skill+model now ships surface no one registers.
- **model is negative-value today.** The descriptor is pure, but it imports value-level `build*Envelope`/`format*` fns AND `defaultModelDeps` from model.ts, which read `process.env` in **14 sites** (158/177/…/854) and construct `new SiloCore()` (model.ts:147). Moving it package-clean requires threading `env` through ~5 builders + parameterizing the handoff bin + inverting builders to deps — a real refactor of model.ts internals for a consumer that can't yet register the result. And if farmhand ever serves model it is read-only anyway (no writable token store), so the mutator machinery would sit unused.
- **skill is middle-ground.** Its seam is genuinely cut (`SkillCommandDeps`, run() bodies touch only `deps.*`); its only prerequisite is promoting `DiagnosticRecommendation` + `buildDiagnosticNextActionPayload` into cli. But it still needs a consumer to supply discover/loadPersistedSkills/loadCheckers/importSkills/persistSkills, and the persistence-promotion is a fork.

**A partial extraction that unblocks the clean case beats a three-way rewrite of app-domain plumbing nobody consumes yet.**

## The seam (confirmed, already cut via deps objects)

- Pure descriptor = name/summary/args/transports/renderers/actions + a `run()` that calls INJECTED functions. Already cut: `ModelCommandDeps` (model.ts:55-60), `SkillCommandDeps` (skill-capability.ts:86-118).
- App-owned (the hard rule): model.ts (14 process.env + SiloCore), model-mutators.ts, defaultModelDeps/defaultSkillDeps, defaultSkillLedgerRoots (process.env+cwd), refarm-home layout, fs/ledger/checker bindings, credential-handoffs.ts (import-time refarmCommand), and capability-registry.ts (each host assembles its own — the declare-once/register-per-app seam).
- **model is a TRAP**: its descriptor is pure but its imported build*/format* envelope builders read process.env inline.

## Package home

A NEW sibling `@refarm.dev/capabilities-builtins` that depends on `@refarm.dev/cli` (+ plugin-manifest). NOT folded into cli — cli deliberately depends only on `@refarm.dev/config` and must NOT gain plugin-surface-loader/quality-checker-ref/silo in its graph.

## Ordered slices (only #1 recommended now)

1. **[S] extension-review** — land `CapabilitySurfaceHooks` into cli by RE-EXPORT (copied verbatim from capability-commander.ts:16-25; the 4 importers keep their `./capability-commander.js` path via a re-export barrel), scaffold `@refarm.dev/capabilities-builtins`, move extension-review-capability.ts verbatim (change only the hooks import), leave a thin re-export barrel in the app so capability-registry.ts is untouched. Verified zero-app-domain (adversarial grep: no process.env, no SiloCore, no ledger; only `loadReviewableManifest` generic fs JSON loading). Prove via `refarm extension review <dir> --json`. ONE commit.
2. **[S, prerequisite-only]** promote `DiagnosticRecommendation` + `buildDiagnosticNextActionPayload` into cli by re-export — no descriptor moves. Only if skill extraction is greenlit.
3. **[M] skill** — move descriptor + hooks + SkillCommandDeps + ~8 pure helpers; leave defaults app-side. **Requires a committed consumer.**
4. **[L, deferred] model** — descriptor surface only, AFTER threading env through the builders + inverting to deps. **Requires a consumer AND the three seams.** Pure cost until then.

## Consequence for break #3 HTTP

The farmhand HTTP plant was chasing a demand that does not exist. Two honest paths:
- **(a)** Ship extension-review extraction (slice 1) as a clean architectural proof + package home, and plant the HTTP projector inside apps/refarm (`refarm serve`) where the populated registry already lives — serving the REAL built-ins today. farmhand plant waits for a real consumer.
- **(b)** Pause the HTTP plant entirely (the projector is built + tested), do slice 1 as the package-home proof, and move to the web projector (apps/me) which is a nearer consumer.

## Open decisions (Arthur)

1. Consumer real/near-term or aspirational? (Source says aspirational → ship extension-review only, stop.)
2. Fold the CapabilitySurfaceHooks prerequisite INTO slice 1 (one commit) or separate (more atomic per §3)?
3. Re-export vs relocate for shared types — confirm thin re-export barrels (additive, lowest surprise).
4. If/when skill extracts: identical sha256 ledger (promote persist/load to storage-side) or each app its own persistence?
