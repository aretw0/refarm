# Vault-seed health handoff feedback - 2026-07-03

Downstream: vault-seed.
Handoff path: `.refarm/handoff/vault-seed/2026-07-03/`.
Accepted sourceGitSha: `4f0e058d1a108a3f185d99fd931f6dd93b703a1c`.
Downstream commit: `487397e feat(refarm): assimilate health handoff`.

## Result

vault-seed assimilated the refreshed `vault-seed-ready` handoff:

- 23 tarballs copied into `vendor/` and checked against `vendor/manifest.json`.
- 23 `consumerInstall.pnpmOverrides` mirrored in `pnpm-workspace.yaml`.
- 15 direct `@refarm.dev/*` file refs remain until npm publication.
- `@refarm.dev/health` is consumed as a dev-only proof package.

## Health Boundary Confirmed

The `health` package matches the requested split for `dgk check`:

- `ToolchainAuditor` can express downstream-owned command/path checks without owning product copy.
- `buildEnvironmentPressureReport` and `planEnvironmentWorkCeiling` return measurement and dispatch guidance without executing recovery.
- Content/prose scoring stays in `quality:v1`; environment and project structure stay in `health`.

vault-seed did not switch product behavior yet. The downstream product step remains a local `dgk check` composition over `health` plus `quality:v1`.

## Consumer Proof

New proof file in vault-seed:

- `scripts/refarm_health_consumer_contract.test.mjs`

Focused downstream gate:

```powershell
node node_modules/vitest/vitest.mjs --config ./vitest.config.mjs --configLoader runner run scripts/refarm_health_consumer_contract.test.mjs scripts/refarm_ds_astro_consumer_contract.test.mjs scripts/refarm_quality_consumer_contract.test.mjs scripts/refarm_content_projection_consumer_contract.test.mjs scripts/refarm_records_consumer_contract.test.mjs scripts/refarm_enrichment_consumer_contract.test.mjs scripts/refarm_source_web_consumer_contract.test.mjs scripts/refarm_credentials_consumer_contract.test.mjs scripts/refarm_local_surface_consumer_contract.test.mjs scripts/refarm_no_reimplementation_contract.test.mjs
```

Result: 10 files, 31 tests passed.

Full downstream suite:

```powershell
pnpm test
```

Result: 90 files, 524 tests passed.

## Windows Portability Notes From The Consumer

Vitest migration exposed host-state assumptions in vault-seed rather than a `health` defect:

- `pnpm test` needs `--configLoader runner` on this Windows checkout so Vitest does not bundle config through esbuild and climb into denied parent directories.
- Telegram publishing tests now inject a temp `rateLimiterStatePath` instead of writing `~/.dgk/rate-limits.json`.
- Release package smoke now uses `uvEnv()` so uv cache/config stay under `.sandbox` instead of the user's global uv cache.

These are downstream gate fixes. No refarm API change is requested from this proof.

## Publication Readiness

`pnpm run refarm:publication:plan` in vault-seed now reports:

- handoff manifest packages: 23
- active file-ref packages to migrate: 23
- direct file refs: 15
- workspace override file refs: 23

The remaining expected action from refarm is publication of the `vault-seed-ready` lane when the release criteria are met.
