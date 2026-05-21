# GitHub Actions Workflows

This directory contains Refarm CI, release and deploy workflows. Treat release and deploy as separate surfaces.

## Core Workflows

### `test.yml` — Continuous Integration

Runs the main quality checks for code changes:

- TypeScript checks.
- Lint.
- Unit, conformance and selected integration tests.
- Build and runtime descriptor smoke where applicable.

### `deploy-dev.yml` — GitHub Pages Deploy

Builds and deploys `apps/dev` to GitHub Pages.

Properties:

- trigger: push to `main`/`master` for app/package/deploy files, plus manual dispatch;
- permissions: `contents: read`, `pages: write`, `id-token: write`;
- setup cache mode: `off`;
- build gate: Heartwood WASM package, `apps/dev`, and Astro base-path check;
- artifact path: `apps/dev/dist`;
- no npm publish or release token usage.

### `release-changesets.yml` — Package Release

Creates Changesets release PRs and publishes packages only when release automation is explicitly enabled.

Properties:

- trigger: push to `main`, plus manual dispatch;
- gate: `vars.RELEASE_AUTOMATION == 'true'`;
- optional owner lock: `vars.RELEASE_OWNER`;
- permissions: `contents: write`, `pull-requests: write`, `id-token: write`;
- setup cache mode: `off`;
- publish command: `changeset publish`;
- npm token: `secrets.NPM_TOKEN`;
- runtime descriptor release path is smoked before publish.

## Local Verification

Use these checks before editing release or deploy workflows:

```bash
pnpm run actions:pins
pnpm run deploy:publish:workflow:test
pnpm run release:check
pnpm run runtime-descriptor:release-smoke
```

`publish-packages.yml` is legacy tag-based automation. Do not use it as the default release path unless it is deliberately revived with a separate contract update.

## Required Secrets And Variables

| Name | Kind | Used by | Purpose |
|---|---|---|---|
| `NPM_TOKEN` | secret | `release-changesets.yml` | npm publish through Changesets |
| `RELEASE_AUTOMATION` | variable | `release-changesets.yml` | explicit opt-in for package release automation |
| `RELEASE_OWNER` | variable | `release-changesets.yml` | optional owner lock |
| `GITHUB_TOKEN` | automatic | GitHub Actions | release PRs and repository operations |

## Release Recovery

If a published version has a problem, prefer deprecation plus a fixed release. Do not use `npm unpublish` for normal recovery because it can break downstream installs.

```bash
npm deprecate @refarm.dev/<package>@<version> "Broken release - use <fixed-version>+"
```

Then prepare a new Changesets release through the normal gated release workflow.
