# @refarm.dev/infra-turbo-cache

Turborepo Remote Cache — Cloudflare Worker + R2.

Implements the [Turborepo Remote Cache API v8](https://turbo.build/repo/docs/core-concepts/remote-caching),
deployed as a Cloudflare Worker backed by R2 storage.

**Provider layer:** uses `@refarm.dev/infra-cloudflare` for all Cloudflare
primitives (account resolution, wrangler exec, R2 bucket management).

## Architecture

```
CI runner
  └─ turbo run ... (TURBO_API / TURBO_TOKEN / TURBO_TEAM)
       └─ Worker (src/worker/index.ts)
            └─ R2 bucket  (artifact storage)
```

Provisioning is handled by `TurboCacheProvisioner`, driven by
`refarm provision cloudflare turbo-cache`.

## Deploy via CLI

```sh
refarm sow                                    # store Cloudflare API token once
refarm provision cloudflare turbo-cache       # create R2 bucket, set secret, deploy Worker
```

The command prints the `TURBO_CACHE_API_URL` and `TURBO_CACHE_TOKEN` values
ready to paste into GitHub repository secrets.

## Manual deploy (without refarm CLI)

```sh
# 1. Create R2 bucket
wrangler r2 bucket create refarm-turbo-cache

# 2. Generate and set auth token
openssl rand -hex 32   # copy output
wrangler secret put AUTH_TOKEN --config src/worker/wrangler.toml

# 3. Deploy Worker
wrangler deploy --config src/worker/wrangler.toml
```

## CI integration

The `.github/actions/setup` composite action reads these secrets when provided:

```yaml
- uses: ./.github/actions/setup
  with:
    turbo-cache-api: ${{ secrets.TURBO_CACHE_API_URL }}
    turbo-cache-token: ${{ secrets.TURBO_CACHE_TOKEN }}
```

When the secret is empty (e.g. fork PRs), the action falls back to a local
`.turbo` GHA cache automatically.

## Team namespacing

Cache keys are namespaced by team slug (`TURBO_TEAM`, default `refarm`) inside
the R2 bucket, so one bucket can safely serve multiple projects.
