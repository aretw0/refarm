# Vault-seed next ocamento feedback - 2026-07-03

Downstream: vault-seed.
Context: after assimilating the refreshed `vault-seed-ready` handoff with
`@refarm.dev/health`.

## Summary

vault-seed sees two next upstream candidates that would materially reduce
downstream and POC-specific glue:

1. a records profile runner;
2. records/explore surface blocks.

It also sees `@refarm.dev/plugin-surface-loader` in progress in the refarm
checkout. vault-seed should not grow a local equivalent; it should wait for a
handoff and consume it as the T1/plugin-surface proof.

## Candidate 1 - Records profile runner

The neutral chain is already proven downstream:

```text
source snapshot -> records:v1 -> enrichment:v1 -> artifact-contract-v1
```

The runner mechanics are no longer vault-specific. Refarm should own the
orchestration and report envelope; vault-seed should keep only profiles,
transforms, PARA placement, vocabulary, and `dgk` UX.

Existing downstream proof files:

- `scripts/vault_records_profile.mjs`
- `scripts/vault_records_profile.test.mjs`
- `scripts/records_etl.mjs`
- `scripts/records_etl.test.mjs`
- `scripts/refarm_artifact_consumer_contract.test.mjs`

Downstream plan:

- `docs/superpowers/plans/2026-07-03-refarm-records-profile-runner-candidate.md`

Acceptance shape for refarm:

- fixture profile emits valid `records:v1`;
- enrichment is optional and idempotent;
- failures become a report, not a host crash;
- artifact emission is stable and optional;
- private source/lookup providers can be injected without forking.

## Candidate 2 - Records/explore surface blocks

vault-seed intentionally keeps `/explorar/` as the canonical route and avoids a
parallel `/records/` app. The reusable pressure is now UI over records, not
another data model.

Priority blocks:

1. `RecordsList` / `RecordsTable`
2. `FacetPanel`
3. `MetricStrip` over record collections
4. `GraphView`
5. `GraphToolbar`
6. `GraphLegend`

These blocks should accept `records:v1`-compatible data and avoid PARA,
vault route, or POC-specific vocabulary assumptions.

Existing downstream proof files:

- `.site/lib/vault-explore.ts`
- `.site/lib/vault-explore.graph.test.ts`
- `scripts/records_table_surface.test.mjs`
- `scripts/mdx_content_surface_contract.test.mjs`
- `scripts/refarm_ds_astro_consumer_contract.test.mjs`

Downstream plan:

- `docs/superpowers/plans/2026-07-03-refarm-records-surface-blocks-candidate.md`

## T1 note - plugin surface loader

`packages/plugin-surface-loader/` appears in progress in refarm and is the right
home for loading plugin-declared themes, skills, and later command/surface
extensions into host registries.

vault-seed should not reimplement this. When it appears in a handoff, the
downstream proof should consume it for T1/white-label/plugin composition.
