# CI Cache Hardening

## Attack: Cache Poisoning via Open `restore-keys`

When GitHub Actions cache uses an open prefix restore key (e.g., `${{ runner.os }}-turbo-`), any cache entry whose key starts with that prefix is eligible for restoration. A PR build can write a cache entry with a matching prefix, and the next main branch build may restore it.

**TanStack incident pattern:** A compromised dependency modifies a build artifact during `npm install`. The PR's CI writes this artifact to the cache. When `main` restores the cache prefix, it picks up the poisoned artifact. Main's build "succeeds" using the PR's compromised output.

## Fix: Disjoint Cache Namespaces

PR builds write to `${{ runner.os }}-turbo-pr-<number>-<hash>`.
Push builds write to `${{ runner.os }}-turbo-push-<hash>` with `restore-keys: ${{ runner.os }}-turbo-push-`.

These are disjoint: `turbo-pr-*` never matches `turbo-push-*` and vice versa.

The setup action (`.github/actions/setup/action.yml`) enforces this via the `is-pr` and `pr-number` inputs. Callers must pass `is-pr: true` and `pr-number: ${{ github.event.pull_request.number }}` for PR-triggered jobs.

## What is NOT a vector

- **pnpm node_modules cache**: `actions/setup-node` with `cache: "pnpm"` uses the lockfile hash as an exact key. PRs that don't change `pnpm-lock.yaml` get the same key as main (safe — same content). PRs that change it get a different hash = different entry, no cross-contamination.
- **Rust cargo cache**: uses Swatinem/rust-cache with content-based keys. No open cross-PR prefix fallback.
- **Playwright browser cache**: lockfile-hashed key. Same analysis as pnpm.
- **Turbo remote cache** (when `TURBO_CACHE_API_URL` is set): the local cache step is skipped entirely. Remote cache security depends on the Turbo cache server's access controls (scoped by team/token).

## Supply chain hardening (complementary)

The workspace uses `pnpm` with `shamefully-hoist=false` and an `onlyBuiltDependencies` allowlist — only packages in the explicit list can run `postinstall`/`prepare` scripts. This closes the install-time code execution vector (a dependency running arbitrary code during `pnpm install`) independently of cache isolation.

## Maintenance

If you add a new `actions/cache` step to the setup action or any workflow, consider whether PRs should be able to poison that cache for main. If yes, scope it with `turbo-pr-` / `turbo-push-` namespacing or set `save-always: false` on PR contexts.

When calling the setup action from a PR-triggered workflow, always pass:
```yaml
is-pr: ${{ github.event_name == 'pull_request' }}
pr-number: ${{ github.event.pull_request.number }}
```
