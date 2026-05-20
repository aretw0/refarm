# CI Cache Hardening

## Attack: Cache Poisoning via Open `restore-keys`

When GitHub Actions cache uses an open prefix restore key (e.g., `${{ runner.os }}-turbo-`), any cache entry whose key starts with that prefix is eligible for restoration. A PR build can write a cache entry with a matching prefix, and the next main branch build may restore it.

**TanStack incident pattern:** A compromised dependency modifies a build artifact during `npm install`. The PR's CI writes this artifact to the cache. When `main` restores the cache prefix, it picks up the poisoned artifact. Main's build "succeeds" using the PR's compromised output.

## Fix: Disjoint Cache Namespaces

PR builds write to `${{ runner.os }}-turbo-pr-<number>-<hash>` with no
`restore-keys`.
Push builds write to `${{ runner.os }}-turbo-push-<hash>` with `restore-keys: ${{ runner.os }}-turbo-push-`.

These are disjoint: `turbo-pr-*` never matches `turbo-push-*` and vice versa.

The setup action (`.github/actions/setup/action.yml`) enforces this via the `is-pr` and `pr-number` inputs. Callers must pass `is-pr: true` and `pr-number: ${{ github.event.pull_request.number }}` for PR-triggered jobs.

## Privileged Workflows

Any workflow that can publish, deploy with OIDC, or write release assets must run
with setup cache disabled:

```yaml
with:
  cache-mode: "off"
```

This is intentionally slower. A workflow with `id-token: write`, package publish
credentials, Pages deployment, or release write permission must not restore
dependency, Turbo, Playwright, or Rust build caches produced by lower-trust
validation contexts.

## Pull Requests

PR jobs run without `actions/setup-node`'s pnpm cache. PR Turbo cache is isolated
by PR number and exact content hash, and it does not use prefix restoration.
Turbo remote cache is disabled for PR contexts even when cache secrets exist.

## What is NOT a vector

- **pnpm cache in PR/publish**: disabled. Trusted push validation may use it.
- **Rust cargo cache in publish/deploy**: disabled by `cache-mode: "off"`.
- **Playwright browser cache in publish/deploy**: disabled by `cache-mode: "off"`.
- **Turbo remote cache in PR/publish/deploy**: disabled by setup policy.

## Supply chain hardening (complementary)

The workspace uses `pnpm` with `shamefully-hoist=false` and an `onlyBuiltDependencies` allowlist — only packages in the explicit list can run `postinstall`/`prepare` scripts. This closes the install-time code execution vector (a dependency running arbitrary code during `pnpm install`) independently of cache isolation.

## Maintenance

If you add a new `actions/cache` step to the setup action or any workflow, consider whether PRs should be able to poison that cache for main. If yes, scope it with disjoint PR/push namespacing and avoid `restore-keys` in PR contexts. For privileged workflows, prefer `cache-mode: "off"` over partial mitigations.

When calling the setup action from a PR-triggered workflow, always pass:

```yaml
is-pr: ${{ github.event_name == 'pull_request' }}
pr-number: ${{ github.event.pull_request.number }}
```
