# @refarm.dev/infra-turbo-cache

Sovereign Turborepo remote cache — Cloudflare Worker backed by R2.

Deploy once per project or org; any Turbo monorepo can point at it via three env vars.

## Architecture

```
CI runner
  └─ turbo run ...
       └─ TURBO_API / TURBO_TOKEN / TURBO_TEAM
            └─ Cloudflare Worker (this package)
                 └─ R2 bucket  (artifact storage)
```

The Worker implements Turborepo's [Remote Cache API v8](https://turbo.build/repo/docs/core-concepts/remote-caching).

## Deploy

### 1. Create the R2 bucket

```sh
wrangler r2 bucket create refarm-turbo-cache
```

### 2. Generate and set the auth token

```sh
openssl rand -hex 32   # copy the output
wrangler secret put AUTH_TOKEN
```

### 3. Deploy the Worker

```sh
npm run deploy -w @refarm.dev/infra-turbo-cache
```

Note the Worker URL printed at the end (`https://refarm-turbo-cache.<account>.workers.dev`).

### 4. Add GitHub repository secrets

| Secret name           | Value                          |
| --------------------- | ------------------------------ |
| `TURBO_CACHE_API_URL` | Worker URL from step 3         |
| `TURBO_CACHE_TOKEN`   | Token generated in step 2      |

### 5. Pass secrets in CI

The `.github/actions/setup` composite action already reads these secrets when passed via `with:`:

```yaml
- uses: ./.github/actions/setup
  with:
    turbo-cache-api: ${{ secrets.TURBO_CACHE_API_URL }}
    turbo-cache-token: ${{ secrets.TURBO_CACHE_TOKEN }}
```

The action sets `TURBO_API`, `TURBO_TOKEN`, and `TURBO_TEAM` in `$GITHUB_ENV` for every subsequent step. When the secret is empty (e.g. forks), the action falls back to a local `.turbo` GHA cache automatically.

## Local development

```sh
wrangler dev
```

Set `AUTH_TOKEN` in `.dev.vars` (never commit this file):

```
AUTH_TOKEN=any-local-secret
```

## Reusing in your own Refarm-based project

1. Copy this package into your monorepo's `packages/` directory.
2. Follow the deploy steps above with your own Cloudflare account.
3. Wire up the setup action as shown in step 5.

The team slug (`TURBO_TEAM`, default `refarm`) namespaces cache keys inside the bucket, so a single R2 bucket can safely serve multiple projects.
