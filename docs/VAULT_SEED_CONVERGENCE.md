# Vault Seed Convergence

Status: calibration note for keeping Refarm and `vault-seed` complementary.

This document records what the `vault-seed` consumer is proving and where Refarm
should harden shared primitives instead of absorbing the product workflow.

## Current Read

`vault-seed` has moved beyond a static Obsidian template. It is becoming a
local-first knowledge operating kit with three clear surfaces:

| Surface | Owner | Role |
| --- | --- | --- |
| Astro site | `vault-seed` | Public reading, navigation, graph, timeline, accessibility, and discoverability. |
| Marimo Lab | `vault-seed` | Local/offline analysis, dataset exploration, feed/outbox review, and human decisions. |
| `dgk` CLI/scripts | `vault-seed` | Vault-local operation: validation, lab ETL/export, Obsidian launch, note bridge, and package scaffolding. |

The important product signal is that `vault-seed` is the interface for people
who want a sovereign knowledge vault. It should not become a Refarm runtime
distribution, and Refarm should not reimplement its vault UX.

## Audience Overlap

The overlap is real but the audience entry point differs:

| Audience | Enters Through | Needs From Refarm Later |
| --- | --- | --- |
| Digital gardeners and researchers | `vault-seed` template, Obsidian, Markdown, published site | Optional agent runtime, validation, provenance, and task handoffs. |
| Operators maintaining many vaults/projects | Refarm CLI/runtime | Stable consumer calibration, external workspace health, and repeatable finish gates. |
| Teams with local-first data workflows | `vault-seed` distributions | Ingestion contracts, schema validation, audit trails, and capability-scoped automations. |
| Agent authors | `dgk` skill packages now, Refarm plugins later | A compatibility path from skills/tools to Refarm manifest/runtime surfaces. |

The convergence target is not one CLI replacing the other. It is a layered path:

```text
dgk CLI = product-local cockpit for vault users
Refarm = shared runtime, handoff, validation, model/task, and plugin substrate
```

`dgk` can eventually call Refarm primitives when present, while remaining useful
without Refarm installed.

## Boundaries

Keep these boundaries explicit:

- `vault-seed` owns vocabulary, onboarding, PARA layout, Obsidian/Marimo/Astro
  flows, distribution templates, and vault-specific UX.
- `Refarm` owns reusable runtime, model/task execution, JSON handoffs,
  external-consumer calibration, capability policy, plugin lifecycle, and shared
  health/complexity primitives.
- `agents-lab` remains a proving ground for agent skills/tools until repeated
  use makes a contract worth promoting.
- Read-only work vaults and prize drafts provide evidence only. They must not
  receive generated Refarm config or mutation unless the operator explicitly
  changes their status.

## Convergence Primitives

These are the useful shared primitives to harden in Refarm before coupling any
consumer CLI directly to Refarm internals:

1. **External workspace profile**
   - `refarm resume --json`
   - `refarm check --next-action --json`
   - `refarm health --policy --json`
   - `refarm health --suggest-policy --json`

   `vault-seed` can use these for calibration without importing app internals.

2. **Command/process handoff**
   - Product CLIs such as `dgk` should be able to expose commands as structured
     process specs instead of ad hoc shell strings.
   - Refarm should keep the reusable representation in `@refarm.dev/cli`; `dgk`
     may later adapt to that shape.

3. **Vault/source provenance**
   - `vault-seed` already wants `source`, `run_id`, `agent`, `dataset_version`,
     hashes, and quality reports for ingestion.
   - Refarm should not own vault-specific schemas, but it can own generic
     provenance and effort/task envelopes that vault pipelines can reference.

4. **Skill/package compatibility**
   - `vault-seed` currently scaffolds Pi-style skill and extension packages.
   - Refarm should provide a future adapter path where those packages can become
     manifest-declared skills/tools without requiring a one-shot rename or
     product migration.

5. **Complexity and workspace health**
   - Large-file, generated-output, docs, and lab artifact pressure belongs in
     `@refarm.dev/health` as reusable auditing.
   - Consumer-specific allowances stay in that consumer's `.refarm/config.json`
     or equivalent checked-in policy.

## What Not To Do

- Do not make Refarm a required dependency for generated vaults.
- Do not move `vault-seed` onboarding, Astro UI, Marimo notebooks, or PARA
  conventions into Refarm.
- Do not duplicate the `dgk` product CLI in `apps/refarm`.
- Do not auto-write `.refarm/config.json` into a vault just because calibration
  suggested a policy.
- Do not treat Pi naming inside `vault-seed` packages as a long-term Refarm
  semantic center. Treat it as compatibility until an adapter is ready.

## Migration Shape

The pragmatic migration path is additive:

1. Keep `dgk` as the vault-local command surface.
2. Let Refarm inspect `vault-seed` as an external consumer through read-only
   templates.
3. Add optional `.refarm/config.json` only in writable consumer repos after
   review, not in read-only mirrors.
4. Promote repeated `dgk` needs into Refarm shared packages only when a second
   consumer or repeated Refarm command needs the same primitive.
5. Later, let `dgk` detect Refarm and delegate advanced flows such as runtime
   tasks, model-backed curation, plugin/package verification, and finish gates.

This keeps `vault-seed` sovereign for its users and lets Refarm become the
daily-driver substrate without centralizing every workflow in `apps/refarm`.

## Serpro Draft Pressure

The local prize drafts should continue to pressure Refarm indirectly:

- Theme 1 maps to sandboxed plugin governance, capability policy, manifest
  integrity, and revocation.
- Theme 2 maps to citizen data portability, consent, auditability, and
  offline-first trust boundaries.
- Theme 3 maps to `vault-seed`: note/vault workflows, provenance, publication
  outbox, local lab analysis, and human-reviewed agent assistance.

Because the work vault is read-only, evidence from those drafts should become
Refarm docs, shared primitives, or explicitly scoped `vault-seed` changes, never
silent writes into the mirror.
