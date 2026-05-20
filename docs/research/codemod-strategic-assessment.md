# Codemod Strategic Assessment

**Date**: 2026-05-17
**Status**: Research
**Subject**: What Refarm and `pi-agent` can learn from [codemod/codemod](https://github.com/codemod/codemod)

---

## Executive Summary

Codemod is not just a codemod runner. Its current architecture combines:

- A local CLI for scaffolding, validating, testing, publishing, and running transformations.
- A workflow model for multi-step migrations with state, parameters, dependency ordering, manual gates, resumability, and cloud campaign semantics.
- A package model that treats transformations and agent skills as distributable artifacts.
- First-class AST tooling through ast-grep/JSSG, plus direct support for AI-assisted transformation steps.
- MCP and harness integration so coding agents can inspect ASTs, run codemod tests, validate packages, and install codemod guidance.

Refarm should not copy Codemod wholesale. Codemod is optimized for large-scale source-code migration campaigns; Refarm is a sovereign plugin/runtime system with capability contracts, WIT boundaries, Farmhand efforts, Barn lifecycle management, Scarecrow policy, and `pi-agent` execution. The useful lesson is the operational shape: deterministic transforms, agent guidance, validation, resumable orchestration, and registry distribution should be one composable loop instead of separate tools.

The strongest opportunity is to make Refarm's internal refactors and `pi-agent` tasks produce reusable "migration capsules": source-scoped plans that combine deterministic AST edits, shell/build checks, AI fixups, review gates, and evidence. In Refarm terms, this should extend the existing plugin/package distribution model rather than create a separate external system.

---

## Relationship to Refarm Plugins

Refarm already had the important distribution idea before this Codemod comparison: plugins are packages. Like Pi packages, they can bundle executable extensions, agent guidance, UI/assets, and workflow affordances, and they can be distributed through package channels such as npm or git. The Codemod insight is not "Refarm needs packages"; Refarm already has that.

What Codemod adds is a more specific product grammar for one class of package: migrations.

In Refarm terms:

| Existing Refarm concept | What it already covers | What Codemod adds |
|---|---|---|
| plugin package | executable capability bundle | migration-specific structure |
| manifest + capabilities | install/runtime permission boundary | declared edit/build/AI/AST privileges |
| Barn | integrity and lifecycle | validation of migration payloads and fixtures |
| Farmhand effort | task execution and streaming results | resumable ordered migration workflow |
| Scarecrow | observation and policy | approval gates for risky migration steps |
| `pi-agent` | autonomous local work | structural tools and reusable migration authoring |

So a migration pack should not be a rival primitive to plugin packages. It should be a plugin package profile: a package whose purpose is to transform data, source, schema, CRDT records, lenses, manifests, or other plugin-owned state across versions.

### Extensions vs. Migration Packs

The same package can expose multiple roles:

- **Extension**: adds new runtime behavior, UI, commands, integrations, or automation.
- **Migration pack**: upgrades existing state or source from one contract/version/lens to another.
- **Skill pack**: teaches an agent how to operate the extension or migration safely.
- **Asset pack**: ships UI, theme, templates, schemas, examples, or fixtures.

This means the question is not whether Refarm plugins can be extensions or migration packs. They can be both when the manifest and lifecycle support multiple roles. The stronger model is:

```text
plugin package
  manifest
  runtime extension
  migration packs
  agent skills
  schemas/lenses
  fixtures/evidence templates
```

The migration role is especially important in Refarm because plugins are not only code. They may own CRDT-backed data shapes, graph nodes, lenses, indexes, views, and sync semantics. A mature plugin developer therefore needs to ship migrations the same way a database-backed application ships schema migrations.

### What Is Actually New

Codemod contributes four concrete ideas that Refarm did not yet have as a named, reusable plugin discipline:

1. **Migration as an authored product**: not just a script in a repo, but a package with metadata, validation, docs, tests, and install/run semantics.
2. **Deterministic-first transformation**: use AST or structured data transforms where possible, then reserve AI for residual cases.
3. **Fixture-driven safety**: migration authors prove expected before/after behavior on representative examples before broad execution.
4. **Agent-operable workflows**: the package carries enough skill/context for an agent to run, inspect, resume, and report the migration without hidden session knowledge.

For Refarm, this is the veil being lifted: plugins are not merely installable functions. They are distributable operational contracts. A plugin can carry its own evolution path, its own data-lens migrations, and its own agent playbooks.

---

## What Codemod Provides

### CLI and Package Lifecycle

The Codemod repository describes itself as the CLI and workflow engine for scaffolding, testing, running, publishing, and sharing codemods locally or through hosted registry/platform services. The public README also indicates active development: as of this assessment, GitHub shows `codemod-cli@1.10.5` as the latest release on 2026-05-13.

The CLI exposes lifecycle commands for:

- `codemod init` to scaffold packages.
- `codemod workflow validate` to validate package structure and workflow schema.
- `codemod workflow run` to run local or registry workflows.
- `codemod workflow resume/status/list/cancel` to manage runs.
- `codemod publish` and registry workflows for distribution.
- `codemod jssg run/test` for fast local iteration on AST transforms.

Important design lesson: Codemod separates quick transform authoring from production orchestration. That maps well to Refarm's distinction between direct agent edits and Farmhand efforts.

### Workflow Model

Codemod workflows are YAML-defined DAGs with:

- `params` for configurable inputs.
- `state` for persisted run data.
- `nodes` with dependency ordering.
- automatic and manual nodes.
- matrix strategy for fan-out.
- sequential steps inside each node.
- local, registry, AST, shell, and AI step types.
- cloud/campaign concepts such as task branches, checkpoint commits, and pull requests.

This matters for Refarm because many "agent tasks" are actually workflows:

1. detect source patterns.
2. apply deterministic edits.
3. run scoped checks.
4. ask AI to handle residual cases.
5. re-run checks.
6. produce evidence and review notes.

`pi-agent` can already perform these manually. Codemod shows that the loop should be declared, resumed, validated, and reused.

### Transform Engines

Codemod makes ast-grep/JSSG a first-class path for source changes. It supports direct development commands, fixture-based tests, dry runs, language selection, thread limits, and multiple strictness modes for comparing outputs.

This is directly relevant to Refarm because this monorepo has many repeated migration shapes:

- package export and `src`/`dist` resolution alignment.
- TypeScript strictness migrations.
- WIT contract evolution.
- manifest/schema updates.
- docs index and ADR link maintenance.
- package rename or namespace migrations.
- agent prompt/skill format migrations.

These are expensive and risky when handled as one-off AI editing sessions. They become safer when expressed as fixture-tested AST transforms plus a small AI residual path.

### AI and Agent Integration

Codemod's CLI now includes an `ai` setup path that installs a master skill, configures Codemod MCP, and installs `/codemod` entrypoints for supported harnesses including Codex. Its MCP server exposes operational tools such as AST dumping, node-type discovery, JSSG test execution, and package validation, plus guidance resources for codemod authoring and troubleshooting.

This is the clearest pi-agent lesson: do not only give agents a shell and filesystem. Give them purpose-built structural tools that reduce uncertainty before editing.

For `pi-agent`, the equivalent is not necessarily MCP. Refarm already has WIT and Tractor. The equivalent should be a capability-gated structural-analysis surface:

- `agent-code-graph.dump-ast`
- `agent-code-graph.find-pattern`
- `agent-code-graph.apply-structured-edit`
- `agent-codemod.test-fixtures`
- `agent-codemod.validate-package`
- `agent-codemod.dry-run`

The host should expose these through WIT or a Farmhand-side adapter, with Scarecrow policy deciding which tools are available in a given effort.

### Package + Skill Distribution

Codemod packages can be workflow-only, skill-only, or workflow + skill. Skill-capable packages carry authored skill content under `agents/skill/<skill-name>/`, and install steps can copy that payload into supported agent harnesses.

Refarm already has stronger concepts for plugin lifecycle, integrity, and capability enforcement through Barn, plugin manifests, and WIT. The useful Codemod pattern is bundling executable automation with agent instruction. A migration should ship both:

- the deterministic transform workflow; and
- the agent skill/guidance for when deterministic automation is insufficient.

In Refarm terms, this suggests a "migration pack" artifact:

```text
refarm-migration-pack/
  refarm.migration.json
  workflow.yaml
  transforms/
  rules/
  fixtures/
  agents/skill/<skill-name>/SKILL.md
  docs/evidence-template.md
```

Barn can validate and sign the pack. Farmhand can execute it. `pi-agent` can consume the skill and run residual steps.

---

## Fit With Refarm

### Internal Refarm Use

Refarm should use Codemod ideas internally for repository evolution:

- Add a research-backed convention for checked-in migration packs under a source-level directory, not generated artifacts.
- Start with a few high-value internal migrations: import path updates, package manifest normalization, docs index maintenance, and WIT package version bumps.
- Require fixtures for deterministic transforms before an agent applies them broadly.
- Treat dry-run output as an evidence artifact in task reports.
- Use scoped validation commands after transform execution, following the repo's existing build/resource discipline.

This would reduce recurring edit risk in a monorepo that already has strict `src`/`dist` stratification and protected surfaces.

### Farmhand / Effort Model

Codemod workflows map naturally to Farmhand efforts:

| Codemod concept | Refarm equivalent |
|---|---|
| workflow package | migration pack or Farmhand effort template |
| workflow node | task group / ordered effort stage |
| workflow step | plugin invocation, shell check, AST transform, AI fixup |
| workflow state | effort state / session contract state |
| params | effort args |
| manual node | Scarecrow approval gate |
| registry package | Barn-published, integrity-checked package |
| campaign branch/PR | optional Git adapter around efforts |

Refarm's advantage is capability enforcement. Codemod allows shell and AI steps as part of a workflow; Refarm can make those capability-scoped, auditable, and policy-gated.

### pi-agent

`pi-agent` should learn three things:

1. Prefer structural perception before editing. AST dumps, pattern matches, and fixture tests are higher-signal than raw text search when transforming code.
2. Separate deterministic migration from AI residual work. Let AST tools handle broad mechanical changes; reserve LLM edits for semantic edge cases.
3. Persist reusable migration knowledge. If an agent discovers a repeatable migration, it should be able to propose a migration pack or skill update instead of leaving the knowledge only in chat.

This aligns with Active Inference: AST tooling and fixture tests are perception actions that reduce uncertainty before broad edits.

---

## Recommended Refarm Roadmap

### Phase 1: Documented Convention

- Create a lightweight migration-pack convention in docs.
- Define required fields: name, version, target packages, capabilities, safety notes, transforms, fixtures, validation commands.
- Add guidance that migration packs must only edit source-level directories unless explicitly approved.

### Phase 2: Agent Tooling Surface

- Add a WIT or Farmhand adapter for AST/pattern tools.
- Start with read-only tools: dump AST, list node types, find syntax-aware patterns.
- Add dry-run and fixture-test tools before allowing write-capable structured edits.

### Phase 3: Barn-Managed Distribution

- Extend Barn validation to cover migration packs.
- Require SHA-256 integrity for transform files and authored skills.
- Add Scarecrow policy for shell/AI/write capabilities inside migration packs.

### Phase 4: pi-agent Authoring Loop

- Teach `pi-agent` to propose migration packs when it detects repeated mechanical edits.
- Let `pi-agent` run fixture tests and produce evidence before applying a pack across the repo.
- Add a "deterministic first, AI second" workflow template for internal refactors.

---

## Risks and Non-Goals

- Do not import Codemod's full platform model. Refarm should stay sovereign and local-first.
- Do not allow arbitrary shell-based migration packs without Scarecrow policy and capability declarations.
- Do not treat AI-generated transforms as trusted until fixtures and scoped checks pass.
- Do not add another registry that bypasses Barn. If migration packs become distributable, Barn should be the integrity and lifecycle authority.
- Do not run broad codemods across protected surfaces without explicit serialized handoff.

---

## Concrete Next Step

The best first implementation is a single internal proof-of-concept migration pack for a low-risk recurring maintenance task. The current package scaffold/conformance plan is the strongest candidate because it already has deterministic templates, a linter, scoped package validation, and two concrete migrations (`sower` and `barn`) to exercise the loop. Alternatives include docs index upkeep or package manifest normalization.

It should include:

- a source-level metadata file;
- one deterministic transform;
- fixture tests;
- a dry-run mode;
- scoped validation commands;
- a short agent skill explaining when and how to use it.

Success criteria: a human or `pi-agent` can run the pack, inspect the dry-run, apply the transform, run checks, and produce evidence without relying on undocumented chat context.

---

## Sources

- [codemod/codemod GitHub repository](https://github.com/codemod/codemod)
- [Codemod introduction](https://docs.codemod.com/introduction)
- [Codemod CLI reference](https://docs.codemod.com/cli)
- [Codemod package structure](https://docs.codemod.com/package-structure)
- [Codemod workflow reference](https://docs.codemod.com/workflows/reference)
- [Codemod MCP](https://docs.codemod.com/model-context-protocol)
