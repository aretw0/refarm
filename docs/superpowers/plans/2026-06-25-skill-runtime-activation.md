# Plan: Skill Runtime Activation

> Spec: `specs/features/2026-06-25-skill-runtime-activation.md`.
> Goal: make roadmap item 6 executable once the skill runtime trigger appears, without moving
> `dgk-skills` into Refarm.

## Task 1 - Confirm trigger

- Verify Refarm has a skill-like invocation surface.
- Select one DGK skill as dogfood.
- Record which existing Refarm engine the skill calls.
- Gate: if no runtime exists, stop and keep this item deferred.

## Task 2 - Red tests for manifest shape

- Add fixture for a minimal `SKILL.md`.
- Add expected `SkillManifestV1` output.
- Assert missing capability declarations fail closed.
- Gate: tests fail for missing parser/adapter.

## Task 3 - Implement adapter

- Implement the smallest parser/adapter needed for the selected skill.
- Keep product vocabulary in adapter input fixtures, not in Refarm engine code.
- Gate: adapter tests pass.

## Task 4 - Invocation smoke

- Run the selected DGK skill through Refarm's invocation surface.
- Compare output with direct DGK fixture or approved snapshot.
- Record engine calls and capability checks.
- Gate: smoke passes or records the concrete runtime blocker.

## Task 5 - Consumer handoff

- Update `docs/GARDENING_SKILLS_TAXONOMY.md` with the selected skill and runtime evidence.
- Update `docs/CONVERGENCE_FACTORY_READINESS.md` if the item moves from deferred to ready.
- Commit as one branch; do not bundle unrelated skill adapters.
