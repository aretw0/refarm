# Plan: Native Skill System Activation

> Spec: `specs/features/2026-06-25-skill-runtime-activation.md`.
> Goal: make roadmap item 6 executable by giving Refarm its own native skill system, without moving
> `dgk-skills` or `agents-lab` skills into Refarm as product-owned code.

This plan is not only about adopting existing skills. Refarm needs a native
skill surface that can read `SKILL.md`-style workflow content, declare required
capabilities, pass through policy, and invoke existing Refarm engines. External
skills are fixtures and consumer pressure; the durable owner is a Refarm
package/plugin manifest surface, not `apps/refarm`.

## Target shape

- **Contract package**: `skill-contract-v1` (or equivalent selected name) owns
  `SkillManifestV1`, metadata parsing, capability declarations, input/output
  envelopes, and conformance fixtures. It is a schema helper, not an installer
  or runtime.
- **Manifest surface**: a package exposes skills through the existing plugin
  manifest model, for example `extensions.surfaces[]` with `layer: "pi"`,
  `kind: "skill"`, and `assets` pointing at the `SKILL.md`. A package can carry
  guides, references, themes, and executable plugin code next to the skill.
- **Authoring space**: user and project spaces may carry unpublished skills,
  extensions, guides, themes, and experiments before packaging. These are local
  sources, not installed runtime artifacts. Packaging is an explicit promotion
  step for sharing, release, tarball handoff, or future peer/device replication.
- **Runtime adapter**: a small adapter maps `SKILL.md` content into a
  policy-checkable invocation plan. It does not execute shell/file operations by
  parsing Markdown directly.
- **Execution receipt**: hosts record engine-call evidence only after an
  approved policy decision. `native:skills:source-engine-smoke` proves this
  internally with `source:v1` through `@refarm.dev/source-local`; it does not
  claim runtime-agent or external skill execution.
- **Execution host**: `runtime-agent` may be the first dogfood host, but the
  contract stays host-neutral so a Refarm plugin can provide or consume skills
  later.
- **Policy boundary**: plugin-manifest/Barn/Scarecrow own install, integrity,
  capability, and denial-path checks before a skill can call tools.
- **Consumer bridges**: `dgk-skills` and `agents-lab` skills remain canonical in
  their projects and become compatibility fixtures for Refarm's contract.

## Task 1 - Confirm native owner

- Verify the native skill surface has a clear owner outside `apps/refarm`.
- Verify the selected package/plugin manifest declares the skill surface instead
  of creating a standalone skill install path.
- Verify local unpublished sources can remain in user/project space until the
  operator chooses to package or replicate them.
- Select one minimal skill fixture (`agents-lab/git-workflow` wrapper or one
  DGK gardening skill) as dogfood.
- Record which existing Refarm engine or capability the skill calls.
- Gate: if no contract owner exists, stop at planning and do not install skills.

## Task 2 - Red tests for manifest shape

- Add fixture for a minimal `SKILL.md`.
- Add expected `SkillManifestV1` output.
- Assert missing capability declarations fail closed.
- Gate: tests fail for missing parser/adapter.

## Task 3 - Implement contract package

- Implement the smallest `SkillManifestV1` parser needed for the selected skill.
- Include conformance helpers that assert metadata, required capabilities,
  source hash, and policy envelope.
- Gate: contract tests pass without loading runtime-agent.

## Task 4 - Declare the plugin manifest surface

- Add or fixture one manifest declaration for the selected skill as a plugin
  surface, not as a separate skill installer.
- Keep executable code, guides, themes, and skill text under one package
  identity when they are distributed together.
- If the selected fixture starts as a local user/project skill, record the
  promotion boundary from authoring space to package/bundle instead of requiring
  publication before dogfood.
- Gate: manifest validation accepts the declared skill surface and rejects
  missing capability declarations.

## Task 5 - Implement adapter

- Implement the smallest adapter needed for the selected skill.
- Keep product vocabulary in adapter input fixtures, not in Refarm engine code.
- Gate: adapter tests pass.

## Task 6 - Invocation smoke

- Run the selected skill through Refarm's invocation surface.
- Compare output with direct DGK fixture or approved snapshot.
- Record engine calls and capability checks.
- Gate: smoke passes or records the concrete runtime blocker. Internal
  source-status dogfood now records a `source:v1` execution receipt; the
  external DGK/agents-lab fixture comparison remains pending.

## Task 7 - Consumer handoff

- Update `docs/GARDENING_SKILLS_TAXONOMY.md` with the selected skill and runtime evidence.
- Update `docs/CONVERGENCE_FACTORY_READINESS.md` if the item moves from deferred to ready.
- Commit as one branch; do not bundle unrelated skill adapters.
