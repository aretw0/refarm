# Codemod Registry Contract

**Status:** Implemented registry - two ready codemods, no hosted/package surface
**Related:** `docs/research/codemod-strategic-assessment.md`, `docs/CONVERGENCE_ROADMAP.md` item 9,
`docs/CONVERGENCE_FACTORY_READINESS.md`

## Problem

The roadmap names codemod candidates, but there is no small contract that decides when a transform
graduates from prose/manual edits to an agent-operable codemod. Without that contract, broad edits
can still pause for tool choice, fixture shape, and safety rules.

## Decision

Introduce a registry for codemod-shaped work before introducing any new codemod runtime. The first
artifact is metadata plus fixtures, not a platform.

Current implementation: `codemods/registry.json` validates with `codemods/registry.test.mjs`.
`ds-token-adoption` and `package-workspace-adoption` are `ready` entries with fixtures, deterministic
dry-run commands, and root `codemods:check` coverage. `credential-provider-rehome` and
`vault-seed-manifest-inventory` were retired because smaller manual/generator-first lanes completed
the work before codemod promotion.

## Registry entry

Each candidate records:

- `id`
- `status`: `candidate`, `ready`, `implemented`, `retired`
- `ownerSurface`: package, docs, consumer repo, or cross-repo
- `tool`: `generator`, `ast-grep`, `ts-morph`, `codemod`, or `manual-reviewed`
- `inputs`
- `fixtures`
- `dryRunCommand`
- `verificationGate`
- `rollbackNote`

## Initial candidates

| ID | Tool bias | Why |
|---|---|---|
| `npm-scope-doc-sweep` | manual-reviewed now, codemod later only if recurring | reviewed replace list avoids blind owner-handle rewrites |
| `credential-provider-rehome` | ast-grep or ts-morph | import boundary can be fixture-tested |
| `ds-token-adoption` | ast-grep plus CSS parser if available | repeated CSS custom-property migration |
| `package-workspace-adoption` | codemod | generated or external consumer manifests need targeted package identity/workspace range rewrites |
| `vault-seed-manifest-inventory` | generator | generated vault files should come from manifest, not broad AST rewrite |

## Non-goals

- No hosted registry.
- No new package until there are at least two `ready` entries and a concrete consumer/distribution
  reason. The threshold is now met; the product reason is still required.
- No broad rewrite without fixtures and dry-run output.
- No codemod for ADR decisions or speculative research.

## Gate

- Registry file exists and validates as JSON.
- Each `ready` entry has fixtures and a dry-run command.
- Documentation names which candidates remain manual-reviewed.
- First implementation proves rollback or limited blast radius.
