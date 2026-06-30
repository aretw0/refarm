# Skill Runtime Activation

**Status:** DRAFT - activation packet for roadmap item 6
**Related:** `docs/CONVERGENCE_ROADMAP.md` item 6, `docs/GARDENING_SKILLS_TAXONOMY.md`,
`docs/VAULT_SEED_CONVERGENCE.md`

## Problem

The gardening taxonomy maps `dgk-skills` to Refarm engines, but the next implementer still needs a
clear trigger for when this becomes executable work. Building a skill adapter before Refarm can
load and invoke skills would create supply ahead of consumption.

## Decision

Treat item 6 as an activation-gated runtime adapter, not a migration of `dgk-skills` into Refarm.
`vault-seed` remains canonical for the DGK skill package. Refarm owns the engine/runtime contract
that can invoke one DGK skill as a consumer proof.

## Activation triggers

Start this item only when all are true:

1. Refarm exposes a skill-like invocation surface with manifest metadata, input envelope, output
   envelope, and capability declaration. **Current:** `@refarm.dev/skill-contract-v1` covers
   manifest, invocation plan, request, host policy decision, execution receipt, and package skill
   surface declaration.
2. One existing `dgk-skills` skill is selected as the dogfood consumer.
3. The selected skill can call an existing Refarm engine (`source:v1`, `context-provider-v1`,
   `sower`, `thresher`, `windmill`, or `homestead`) without product vocabulary moving upstream.
   **Current:** an internal source-status smoke calls `source:v1` through
   `@refarm.dev/source-local`, an external `agents-lab` git-workflow wrapper smoke records
   upstream source evidence plus a `source:v1` receipt without installing or executing the
   external skill, and `native:skills:dgk-vault-search-smoke` records the same wrapper/evidence
   pattern plus a package-declared `pi/skill` surface for `vault-seed`'s
   `dgk-skills/vault-search` without executing `dgk` or Obsidian CLI.

## Scope

- Define `SkillManifestV1` minimum fields for identity, description, inputs, outputs,
  capabilities, and engine bindings.
- Define a `dgk-skills` compatibility adapter that reads existing `SKILL.md` metadata and produces
  the Refarm manifest shape.
- Run one DGK skill through the Refarm invocation surface. The current DGK proof is a
  wrapper/evidence smoke; runtime-host execution remains a later gate.
- Prove the adapter does not depend on vault-specific folder names except through declared input.

## Non-goals

- Moving `dgk-skills` out of `vault-seed`.
- Creating a general plugin system.
- Creating new Refarm engines just to satisfy the first skill.
- Turning every agent instruction file into a Refarm skill.

## Consumer proof

The first proof must run exactly one existing DGK skill through Refarm and compare its output with
the direct DGK invocation fixture. The skill remains authored and reviewed in `vault-seed`; Refarm
only supplies the runtime envelope.

## Gate

- Manifest parser rejects missing capability declarations.
- Adapter fixture maps one `SKILL.md` into `SkillManifestV1`.
- Invocation smoke runs one DGK skill through Refarm and records engine calls. The internal
  `native:skills:source-engine-smoke` records source-engine evidence first,
  `native:skills:agents-lab-git-workflow-smoke` proves the external wrapper pattern, and
  `native:skills:dgk-vault-search-smoke` closes the first DGK wrapper fixture proof and validates
  its package-declared skill surface. Runtime-host execution and direct DGK fixture comparison
  still remain after install/policy gates.
- No import from `vault-seed` product paths appears in Refarm runtime code.
