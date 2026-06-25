# Codemod Registry Contract

**Status:** DRAFT - roadmap item 9 follow-up
**Related:** `docs/research/codemod-strategic-assessment.md`, `docs/CONVERGENCE_ROADMAP.md` item 9,
`docs/CONVERGENCE_FACTORY_READINESS.md`

## Problem

The roadmap names codemod candidates, but there is no small contract that decides when a transform
graduates from prose/manual edits to an agent-operable codemod. Without that contract, broad edits
can still pause for tool choice, fixture shape, and safety rules.

## Decision

Introduce a registry for codemod-shaped work before introducing any new codemod runtime. The first
artifact is metadata plus fixtures, not a platform.

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
| `vault-seed-manifest-inventory` | generator | generated vault files should come from manifest, not broad AST rewrite |

## Non-goals

- No hosted registry.
- No new package until at least two entries are `ready`.
- No broad rewrite without fixtures and dry-run output.
- No codemod for ADR decisions or speculative research.

## Gate

- Registry file exists and validates as JSON.
- Each `ready` entry has fixtures and a dry-run command.
- Documentation names which candidates remain manual-reviewed.
- First implementation proves rollback or limited blast radius.
