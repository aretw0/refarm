# DevOps & Developer Setup Guide

> 🔧 **Environment Configuration, Security, and Development Infrastructure for Refarm**

---

## Table of Contents

- [Dev Container Setup](#dev-container-setup)
- [Refarm CLI Availability](#refarm-cli-availability)
- [Security & Vulnerability Management](#security--vulnerability-management)
- [Environment Validation](#environment-validation)
- [CI Caching Strategy](#ci-caching-strategy)
- [Commit Automation Guardrails](#commit-automation-guardrails)
- [Docker & Container Notes](#docker--container-notes)

---

## Commit Automation Guardrails

`pnpm run git-commit-auto` now treats high-impact groups as **important commits**
(security, CI/release surfaces, Rust/WIT contract paths).

For these groups, the tool still handles the operational path (`git add` + `git commit`),
but requires explicit commit-message confirmation before execution. This keeps edge-case
semantics human-curated while preserving automation for repetitive mechanics.

Strict mode (recommended for stabilization/release windows):

```bash
GIT_COMMIT_AUTO_STRICT=1 pnpm run git-commit-auto
# or
pnpm run git-commit-auto -- --strict-important
```

Strict mode rejects generic messages (e.g. `chore: update implementation`) and
requires specific commit wording for important/low-confidence groups.

### Validation Cache Policy

Local validation should not repeat expensive work when the inputs have already
been checked. Prefer Turbo-scoped commands over per-package loops so repeated
lanes become cache hits:

```bash
pnpm exec turbo run lint --filter=./apps/refarm
pnpm exec turbo run type-check --filter=./apps/refarm
pnpm exec turbo run test --filter=./apps/refarm
```

The pre-push hook follows this rule for changed workspaces and records completed
lanes per push SHA in `.git/.refarm-prepush-validated-lanes`. If a push is
interrupted after a lane passes, the next attempt skips that lane for the same
SHA instead of recomputing it. Full successful pre-push runs are still recorded
in `.git/.refarm-prepush-validated-shas`.

## Dev Container Setup

### Overview

Refarm uses **VS Code Dev Containers** to provide a consistent, reproducible development environment across all contributors.

**Environment Details:**

- **Base:** Debian GNU/Linux 12 (bookworm)
- **Node.js:** v22.16.0
- **pnpm:** 11.1.2 (pinned via `packageManager` in `package.json`, managed by corepack)
- **Rust:** 1.94.0
- **Cargo:** 1.94.0

### Automatic Setup

When opening the workspace in VS Code with the Remote Containers extension:

1. **Container Build** — Docker builds the image from `.devcontainer/devcontainer.json`
2. **Post-Create Hook** — Executes `.devcontainer/post-create.sh`:
   - Fixes cache/toolchain permissions for mounted volumes
   - Ensures Rust targets (`x86_64-unknown-linux-gnu`, `wasm32-unknown-unknown`, `wasm32-wasip1`)
   - Ensures Rust components (`rust-src`, `clippy`, `rustfmt`) for local/CI parity
   - Installs cargo tools: `cargo-component`, `wasm-tools`
   - Runs `pnpm install --frozen-lockfile` to install workspace dependencies
   - Installs Playwright browsers (`pnpm -C validations/sqlite-benchmark/browser exec playwright install --with-deps`)
   - Runs `pnpm run hooks:install`
   - Runs `pnpm run factory:preflight` for deterministic readiness checks
3. **Post-Start Hook** — Executes `.devcontainer/post-start.sh`:
   - Re-validates Rust toolchain health (`stable` + component baseline checks)
   - Reinstalls git hooks when missing
   - Warns when GitHub CLI authentication is missing for push-capable Git operations

### GitHub Authentication In Devcontainers

The devcontainer can prepare Git transport, but it cannot create GitHub
credentials without an operator-approved secret. The bootstrap scripts configure
SSH-to-HTTPS fallback for GitHub remotes and run `gh auth setup-git` when an
existing `gh` login is available.

After opening a fresh container, authenticate once:

```bash
gh auth login -h github.com -p https -w
gh auth setup-git
gh auth status
```

Then verify push access with the current remote:

```bash
git ls-remote --heads origin >/dev/null
git push origin develop
```

If you already have a personal access token, use:

```bash
gh auth login --with-token
gh auth setup-git
```

`post-start.sh` will report `GitHub auth missing. Run: gh auth login` when no
`GH_TOKEN` and no stored `gh` login are available. This is expected on a fresh
container or after rebuilding without a persisted GitHub CLI config volume.

### Refarm Silo Persistence

`refarm sow` writes operator credentials to `~/.refarm/identity.json` through
`@refarm.dev/silo`. The devcontainer mounts `/home/vscode/.refarm` as the
Docker volume `refarm-home`, so these credentials survive normal container
rebuilds. Removing Docker volumes or rebuilding with a different volume name
intentionally resets the Silo.

Use this after a fresh setup or intentional reset:

```bash
refarm sow --cloudflare
refarm provision cloudflare turbo-cache --github-secrets
```

OAuth model logins from `refarm sow` use local callback ports in the
devcontainer:

- OpenAI Codex: `localhost:1455/auth/callback`
- Anthropic Claude: `localhost:53692/callback`

These ports are declared in `.devcontainer/devcontainer.json` so VS Code
forwards them to the host browser. If forwarding is unavailable, the CLI falls
back to prompting for the redirect URL or authorization code. Set
`REFARM_OAUTH_CALLBACK_MODE=manual` to force paste-only behavior.

Interactive credential flows open official provider links by default when a TTY
is attached. Headless and CI runs do not open browser windows. To disable this
for operator sessions, set either:

```json
{
  "operator": {
    "openExternalLinks": "never"
  }
}
```

or export `REFARM_OPEN_EXTERNAL_LINKS=never`.

Use `--github-secrets` for normal operator runs. It writes
`TURBO_CACHE_API_URL` and `TURBO_CACHE_TOKEN` through `gh secret set` without
printing the cache bearer token to stdout. `--print-secrets` exists only for
private, local recovery sessions where manual copying is unavoidable.

## Refarm CLI Availability

`pnpm run cli:dev` keeps the `@refarm.dev/refarm` TypeScript build running in
watch mode, but it is not responsible for installing a shell command. The
devcontainer installs a persistent `refarm` shim during post-create and repairs
it on post-start when missing:

```bash
pnpm run cli:install
refarm sow
```

The shim lives in the devcontainer user bin directory and calls the current
`apps/refarm/dist/index.js`, so a running `pnpm run cli:dev` updates the command
behavior without reinstalling the shim. `pnpm run cli:install` builds the CLI
only when `dist/index.js` is missing; use `pnpm run cli:install -- --build` to
force a rebuild before reinstalling it.

Preview the install target without writing shims:

```bash
pnpm run cli:install -- --dry-run
pnpm run cli:install -- --dry-run --json
```

`--json` emits the same `nextCommand` handoff shape used by the operator loop,
so automation can install or preview the shim and then continue with
`refarm check --next-action --json`. The installer also supports `--help` and
fails closed on unknown arguments instead of ignoring them.

Validate the installer, devcontainer contract, and node-substrate diagnostic
surface without mutating a foreign checkout:

```bash
pnpm run cli:install:verify
```

Use `REFARM_CLI_BIN_DIR=<dir>` to install into an explicit directory. On
Windows, the default user-level target is `%APPDATA%\npm`, matching the normal
npm global shim location. After any install, continue with:

```bash
refarm check --next-action --json
```

If the check reports node substrate materialization drift, do not repair a
foreign `node_modules` tree silently. Use the environment-owned checkout or set
the explicit rebuild opt-in described by the diagnostic.

For non-interactive Docker Desktop or `docker exec` sessions, use the
devcontainer's `farm` wrapper so commands run as the dev user with the same
`HOME`, `PNPM_HOME`, and `PATH` as VS Code terminals:

```bash
docker exec <container> farm vscode /workspaces/refarm refarm resume --json
```

Direct `docker exec <container> refarm ...` is intentionally not the contract:
that runs in the container runtime's default shell/user context and may not see
the dev user's persisted shim directory.

### Devcontainer Image Baseline (Tracked)

Refarm now uses a repo-local build file: `.devcontainer/Dockerfile`.

Purpose:

- Keep system-level dependencies versioned in Git
- Ensure fresh container builds already support diagram generation (`pnpm run diagrams:fix`)
- Avoid one-off manual apt installs that are lost on rebuild

Current image-level dependencies explicitly tracked in Dockerfile:

- Mermaid CLI/headless Chromium runtime libraries:
  - `libdbus-1-3`, `libatk1.0-0`, `libatk-bridge2.0-0`, `libcups2`, `libnss3`
  - `libx11-xcb1`, `libxcomposite1`, `libxdamage1`, `libxfixes3`, `libxrandr2`
  - `libgbm1`, `libpango-1.0-0`, `libcairo2`, `libasound2`, `libatspi2.0-0`, `libgtk-3-0`

Mermaid design system baseline:

- Global style configuration file: `specs/diagrams/mermaid.config.json`
- Diagram generation script (`scripts/check-diagrams.mjs`) always passes this config to Mermaid CLI
- Any style changes must be applied in this file, then regenerated via `pnpm run diagrams:fix`

Tracking rule:

- If any development command fails due missing shared libraries in container (for example `error while loading shared libraries`), update both:
  - `.devcontainer/Dockerfile` (authoritative package list)
  - `docs/DEVOPS.md` (this section)
- Then run a full container rebuild to validate the baseline.

### Manual Rebuild

If you need to rebuild the container:

```bash
# VS Code Command Palette (Ctrl+Shift+P)
> Dev Containers: Rebuild Container
```

After rebuild, run baseline validation:

```bash
pnpm run diagrams:fix
pnpm run test:unit
```

### Troubleshooting

**Issue: pnpm permission errors in post-create**

- **Cause:** pnpm store or home directory contains root-owned files
- **Fix:** Already handled in `post-create.sh` (repairs ownership on `~/.local/share/pnpm` and toolchain directories)
- **Manual workaround:** `sudo chown -R vscode:vscode ~/.local/share/pnpm`

**Issue: Package installation failures**

- **Cause:** Stale node_modules or pnpm-lock.yaml mismatch
- **Fix:** Delete node_modules and reinstall from lockfile:

  ```bash
  rm -rf node_modules
  pnpm install --frozen-lockfile
  ```

**Issue: Wizer optional binary warning during devcontainer post-create**

- **Symptom:** `pnpm install` logs a warning similar to `Failed to create bin ... @bytecodealliance/wizer-win32-x64 ... ENOENT`.
- **Cause:** Docker Desktop bind mounts can expose stale `node_modules/.pnpm` entries from a previous host install. `@bytecodealliance/wizer` publishes one optional binary package per platform, and stale non-Linux packages may leave broken bin links in the Linux devcontainer.
- **Fix:** `post-create.sh` removes stale non-linux-x64 Wizer optional package artifacts before `pnpm install --frozen-lockfile`. If the warning persists after reopening the devcontainer, use the broader package installation workaround above.

**Issue: `sh: 1: playwright: not found` during devcontainer post-create**

- **Cause:** the root workspace does not expose a `playwright` bin. Playwright is declared by the E2E validation packages.
- **Fix:** `post-create.sh` runs Playwright through `validations/sqlite-benchmark/browser`, which owns `@playwright/test`.

**Issue: `cargo clippy` / `cargo fmt` missing locally (but required by CI)**

- **Symptom:** Commands fail with messages like:

  ```text
  error: 'cargo-clippy' is not installed for the toolchain
  error: 'cargo-fmt' is not installed for the toolchain
  ```

- **Fix:** first ensure toolchain directories are writable, then install components:

  ```bash
  sudo chown -R "$USER":"$USER" /usr/local/rustup /usr/local/cargo
  rustup component add rust-src clippy rustfmt
  ```

- **Validation:**

  ```bash
  cargo clippy --version
  cargo fmt --version
  pnpm run factory:preflight
  ```

**Issue: Mermaid/Chromium fails with missing shared library**

- **Symptom:** `pnpm run diagrams:fix` fails with `error while loading shared libraries: <libname>.so`
- **Root cause:** devcontainer image missing required runtime library for headless Chromium
- **Fix process:**
  1. Add missing package to `.devcontainer/Dockerfile`
  2. Rebuild container
  3. Re-run `pnpm run diagrams:fix`
  4. Document dependency update in this DevOps guide

**Issue: GitHub Actions fails with `Unrecognized named-value: 'steps'` in `uses:`**

- **Symptom:** Workflow validation fails on lines like:

  ```yaml
  uses: actions/upload-artifact@${{ steps.setup.outputs.upload-artifact-version }}
  ```

- **Root cause:** `uses:` does not support runtime expressions for action version refs in workflow syntax. The ref must be static at parse time.
- **Fix applied (Mar 6, 2026):** Replaced expression-based refs with local wrapper actions:
  - `./.github/actions/upload-artifact` (internally pinned to `actions/upload-artifact@v7.0.1`)
  - `./.github/actions/codecov-upload` (internally pinned to `codecov/codecov-action@v5.5.2`)
  - `./.github/actions/github-script` (internally pinned to `actions/github-script@v7`)
  - `./.github/actions/create-pr` (internally pinned to `peter-evans/create-pull-request@v8.1.0`)
- **Additional correction:** Removed stale `create-pr-version` propagation from workflows and deleted unused version outputs from `./.github/actions/setup`.
- **Prevention rule:** Never interpolate `${{ }}` in `uses:`. For centralization, pin external versions inside local wrapper actions.

**Issue: Local action not found (`Can't find 'action.yml' ... .github/actions/...`)**

- **Symptom:** Jobs fail with messages like:

  ```text
  Can't find 'action.yml', 'action.yaml' or 'Dockerfile' under '/home/runner/work/<repo>/<repo>/.github/actions/<action-name>'
  ```

- **Root cause:** Local actions (`./.github/actions/...`) are resolved from the checked-out workspace. If `actions/checkout` has not run in that job, the local action path does not exist yet.
- **Fix applied (Mar 6, 2026):** Added `actions/checkout@v6.0.2` as the first step in all jobs that invoke local actions.
- **Additional correction:** Simplified `./.github/actions/setup` to only configure Node + `pnpm install --frozen-lockfile` (checkout moved to workflows/jobs).
- **Prevention rule:** In every job that uses `./.github/actions/*`, run checkout first.

**Note: `refarm/refarm` path in runner logs is expected**

- **Observed pattern:** Paths like `/home/runner/work/refarm/refarm/...` appear in Actions logs.
- **Why this happens:** GitHub-hosted runners use `/home/runner/work/<repository>/<repository>` by default. The first segment is the workspace root folder, and the second is the checked-out repository directory.
- **Interpretation:** This is not path duplication bug by itself.
- **When to worry:** Only if errors indicate missing files inside that path (for example, local actions before checkout), wrong working directory assumptions, or unexpected nested checkouts.

**Issue: Jekyll tries to parse Astro files during Pages build**

- **Symptom:** `Invalid YAML front matter` in `*.astro` files during GitHub Pages/Jekyll build.
- **Root cause:** No Jekyll config existed, so non-Jekyll source files were scanned.
- **Fix applied (Mar 6, 2026):** Added root `_config.yml` with `exclude` rules for app/source trees and `**/*.astro`.

**Issue: Astro build fails with `Unexpected "const"` in `dev.astro`**

- **Symptom:** `astro build` fails pointing to `apps/dev/src/pages/dev.astro` with `Unexpected "const"`.
- **Root cause:** TypeScript sample code was embedded directly inside `<textarea>...</textarea>` in an Astro template. Curly braces and template interpolation tokens (`{}`, `${}`) inside that inline block were interpreted by the Astro parser.
- **Fix applied (Mar 6, 2026):** Moved sample editor content to a frontmatter string (`defaultPluginCode`) and rendered it via `{defaultPluginCode}` in the textarea.
- **Additional correction:** Replaced TypeScript-only syntax in inline `<script>` with plain JavaScript (`!`, type annotations, and `as` assertions removed).
- **Verification:** `pnpm run build -w @refarm.dev/studio` succeeds locally.

**Warning: "The CJS build of Vite's Node API is deprecated" in Git Hooks**

- **Symptom:** Git pre-push hook logs show repeated deprecation warning:

  ```
  The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.
  ```

- **Root cause:** Vitest internally uses Vite's CommonJS API instead of ESM API. This occurs specifically during `pnpm run test:unit` when Vitest initializes, not during lint or type-check commands.

- **Impact:** Purely cosmetic; does not affect test functionality or results. Clutters git hook output making it harder to spot actual issues.

- **Investigation process (Mar 6, 2026):**
  1. **Initial attempt:** Added `export VITE_CJS_IGNORE_WARNING=true` environment variable to hook.
     - **Result:** Failed. Vite doesn't respect this env var consistently across all contexts.
  
  2. **Discovery:** Ran hook commands individually:
     - `pnpm run lint` → ✅ No warning
     - `pnpm run type-check` → ✅ No warning  
     - `pnpm run test:unit` → ❌ Warning appears (Vitest loads Vite)
  
  3. **Root identification:** Warning originates from Vitest's internal Vite usage during test initialization, written to stderr.

- **Fix applied (Mar 6, 2026):**
  - Created `filter_vite_warning()` shell function in pre-push hook using `grep -v` to filter stderr:

    ```bash
    filter_vite_warning() {
      grep -v "The CJS build of Vite's Node API is deprecated" | \
      grep -v "vite.dev/guide/troubleshooting"
    }
    ```

  - Applied filter to all npm commands in hook that might invoke Vitest:
    - `pnpm run lint 2>&1 | filter_vite_warning`
    - `pnpm run type-check 2>&1 | filter_vite_warning`
    - `pnpm run test:unit 2>&1 | filter_vite_warning`

- **Why grep filter instead of env var:**
  - More reliable: works regardless of how Vite is configured internally
  - Surgical: only removes this specific message, preserves all other warnings/errors
  - Maintainable: easy to update pattern if message changes

- **Long-term resolution:** Will be resolved when Vitest ecosystem fully migrates to Vite's ESM API (upstream dependency work).

- **Verification:**

  ```bash
  pnpm run hooks:install  # Reinstall hook with filter
  .git/hooks/pre-push 2>&1 | grep -c "CJS build"  # Should return 0
  ```

- **Files modified:**
  - `scripts/install-git-hooks.mjs` - Added filter function and applied to all pnpm commands

---

## CI Caching Strategy

### Current Baseline (May 5, 2026)

The CI lanes are intentionally split by responsibility:

- **`Test & Quality`** owns monorepo health: project consistency, security, TS config preflight, Farmhand/refarm/pi-agent smokes, Tractor gates, Turbo verification, E2E, summary, and metrics.
- **`Granular Matrix Tests`** owns package compatibility across local/published edges. It is not the general monorepo health gate.
- **`Phase Gates`** (`quality-gates.yml`) owns label-driven development intent (`phase:sdd`, `phase:bdd`, `phase:tdd`, `phase:ddd`). No phase label is a success-with-notice, not a failure.
- **Docs validators** (`Validate Diagrams`, `Validate MDT Docs`, and reusable docs validation) own documentation renderability/drift with content-addressed cache.

Implementation baseline:

- **Dependency cache:** `pnpm/action-setup@v4` + `actions/setup-node` with `cache: pnpm` in `./.github/actions/setup`.
- **Rust Target Provisioning:** `./.github/actions/setup` accepts a `rust-target` input (default: `wasm32-wasip1`) to keep WASM compilation setup centralized.
- **Turbo env passthrough:** `turbo.json` forwards `RUSTUP_HOME`, `CARGO_HOME`, and `RUSTUP_TOOLCHAIN` to avoid Rust manifest drift in parallel Turbo tasks.
- **E2E owns its build dependencies:** the standalone `workspace-build` artifact flow is retired for normal PR validation. E2E runs through Turbo in its own runner and owns any build dependency it needs.
- **Playwright system dependencies:** setup installs `playwright install-deps chromium firefox webkit` so browser cache hits do not mask missing OS libraries.
- **Content-signature validation cache:** `scripts/ci/content-signature.mjs` hashes the validator name, version/extra context, pathspecs, tracked file names, and tracked file contents.
- **Test & Quality result cache:** `quality` and `e2e` restore `.artifacts/validation-cache/test-quality` / `test-e2e`; cache markers are written only after successful fresh validation.
- **Granular Matrix result cache:** `Matrix Discovery` restores `.artifacts/validation-cache/granular-matrix`; on cache hit it emits an explicit reuse notice and returns an empty matrix. `Matrix Cache Finalize` records a marker only after the dynamic matrix succeeds or is legitimately skipped.
- **Docs validation cache:** `reusable-validate-docs.yml` computes/restores content-addressed documentation validation results for diagrams/MDT-style validations.
- **Duplicate push suppression:** push runs on `develop` skip heavy validation when an open PR already validates the same head branch; PR runs remain canonical.
- **E2E affected-first execution:** `Run E2E Tests (affected)` uses `--filter=${{ needs.changes.outputs.turbo_filter }}` when base commit is locally resolvable; otherwise falls back to full E2E safely.
- **E2E placeholder short-circuit:** `e2e` is skipped when root `test:e2e` script is still the placeholder (`No E2E tests configured yet`).
- **Vitest reporting (CI):** default Vitest GitHub summary blocks are suppressed and replaced with an aggregated detailed report (`.artifacts/vitest/summary.md` + uploaded artifact `vitest-detailed-report`).
- **Cargo registry transport:** WASM build jobs set
  `CARGO_HTTP_MULTIPLEXING=false` to avoid intermittent crates.io HTTP/2
  framing failures during `cargo component build`. This is a transport
  hardening setting, not a compilation bypass.
- **Text quality gate:** selected calibration docs and the dependency-free
  text-quality scorer run a direct Node-only check in `Test & Quality` when
  those files change. This keeps docs/prose pressure visible without forcing
  full package installation for unrelated docs-only edits.

### Invalidation Rules

- **pnpm store/dependency cache invalidates when:** Node version or `pnpm-lock.yaml` changes.
- **Playwright cache invalidates when:** lockfile, Playwright config, runner OS, or setup dependency policy changes.
- **Turbo cache invalidates when:** lockfile, `turbo.json`, runner OS, or relevant task inputs change.
- **Content-signature validation cache invalidates when:** any tracked file selected by the gate pathspecs changes, the validation name changes, `REFARM_SIGNATURE_VERSION` changes, or `REFARM_SIGNATURE_EXTRA` changes.
- **Docs validation cache invalidates when:** selected documentation inputs or the validation command change.
- **Matrix result cache invalidates when:** package/app/validation inputs or matrix runner/setup scripts change.

### Why This Avoids Waste Without Hiding Risk

- Keeps CI **fail-closed**: no previous successful marker for the current signature means the gate runs fresh.
- Makes reuse explicit: cache-hit steps emit notices such as “Reusing previous successful Test & Quality validation for unchanged inputs.”
- Avoids duplicate heavy push validation when PR validation is canonical for the same `develop` head.
- Avoids repeated Playwright browser downloads and missing-system-library failures.
- Avoids rerunning `quality`, `e2e`, and package matrix work when their content signatures are unchanged.
- Keeps `.project` validation running even when the broader `quality` gate is reused.
- Avoids hard failure mode when turbo filter base SHA is unavailable in shallow SCM state (auto full fallback).
- Improves test observability with per-workspace breakdown, slowest test files/cases, and CI run timing snapshots in `ci-metrics` artifacts.

### Observed Cache-Proof Runs

- Fresh `Test & Quality` run for `b4d736a2`: recorded successful `test-quality` and `test-e2e` markers after the validator changed.
- Controlled rerun of `Test & Quality` (`25400683334`): `quality` cache hit in 7s and `e2e` cache hit in 8s; total workflow about 2m10s.
- Fresh `Granular Matrix Tests` run (`25400683337`): dynamic compatibility matrix passed in 13m43s and recorded a marker through `Matrix Cache Finalize`.
- Controlled rerun of `Granular Matrix Tests` (`25400683337`): `Matrix Discovery` cache hit in 9s, returned an empty matrix, and skipped dynamic matrix jobs.

### Residual Cost (Expected)

- `pnpm install --frozen-lockfile` still runs once per job that needs setup due to job isolation on hosted runners.
- `audit-moderate` still performs a non-blocking audit/report flow and is not currently content-signature cached.
- Turbo remote cache reduces repeated task execution when `TURBO_CACHE_API_URL` and `TURBO_CACHE_TOKEN` are configured. Push runs use the shared `refarm` namespace. Same-repository PRs may use a PR-scoped namespace; fork PRs remain local-cache only.

### GitHub Pages base-path contract (Astro)

`Deploy to Refarm.dev` now builds Astro with explicit base/site envs:

- `ASTRO_BASE`: defaults to `/<repo>/` (project pages; for this repo, `/refarm/`)
- `ASTRO_SITE`: defaults to `https://<owner>.github.io/<repo>/`

Override via repository variables when moving to custom domain:

- `REFARM_ASTRO_BASE=/`
- `REFARM_ASTRO_SITE=https://refarm.dev/`

A CI guard validates generated HTML links against `ASTRO_BASE`:

- `node scripts/ci/check-astro-base-links.mjs apps/dev/dist "$ASTRO_BASE"`

Domain rollout checklist:

- `docs/DOMAIN_REFARM_DEV_CUTOVER.md`

### Turbo Remote Cache

**Status:** Supported through the Cloudflare-backed remote cache service. The
shared setup action probes the Worker before enabling Turbo remote cache, then
falls back to local `.turbo` cache if the service is unavailable.

**What It Provides:**

Turbo remote cache allows task output reuse across different CI runs and machines. Instead of rebuilding/retesting on every workflow run, Turbo checks if inputs (source files, dependencies) match a previous run and restores outputs (build artifacts, test results) from remote storage.

**Expected Benefits:**

- **Cross-run cache hits:** If code/dependencies haven't changed, `turbo run build test lint` skips actual execution and restores cached outputs.
- **Parallel developer cache sharing:** Local dev builds can reuse CI outputs and vice-versa.
- **Reduced CI minutes:** Jobs skip redundant tasks when commit doesn't affect relevant workspaces.

**Prerequisites:**

- Cloudflare-backed `@refarm.dev/infra-turbo-cache` service provisioned.
- `TURBO_CACHE_API_URL` secret added to repository settings.
- `TURBO_CACHE_TOKEN` secret added to repository settings.

**Configuration Steps:**

1. **Add secrets to GitHub repository:**
   - Navigate to repository Settings → Secrets and variables → Actions
   - Add `TURBO_CACHE_API_URL` (Worker URL)
   - Add `TURBO_CACHE_TOKEN` (Worker bearer token)

2. **Use the shared setup action:**

   ```yaml
   - uses: ./.github/actions/setup
     with:
       turbo-cache-api: ${{ secrets.TURBO_CACHE_API_URL }}
       turbo-cache-token: ${{ secrets.TURBO_CACHE_TOKEN }}
       trusted-pr-cache: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository }}
       is-pr: ${{ github.event_name == 'pull_request' }}
       pr-number: ${{ github.event.pull_request.number }}
   ```

3. **Verify turbo.json cache configuration:**
   - Ensure `turbo.json` has proper `outputs` declared for each task.
   - Current config already specifies outputs for `build`, `test`, and `lint` tasks.

4. **Test remote cache:**
   - Run workflow twice with identical code.
   - Second run should show `>>> FULL TURBO` with cache hits from remote.
   - Check setup logs for `Remote Turbo cache configured`.

**Trust boundaries:**

- Push runs use the default `refarm` remote namespace.
- Same-repository PRs use `refarm-pr-<number>`.
- Fork PRs do not use remote cache even when secrets exist.

**Cost Consideration:**

- Cloudflare R2 stores Turbo artifacts under the namespace selected by `TURBO_TEAM`.
- The Worker rejects artifacts larger than `MAX_ARTIFACT_BYTES` (default: 50 MB).
- Scheduled cleanup deletes stale artifacts according to `ARTIFACT_TTL_SECONDS` (default: 30 days).

**Documentation:**

- Official guide: <https://turbo.build/repo/docs/core-concepts/remote-caching>
- Self-hosted setup: <https://turbo.build/repo/docs/core-concepts/remote-caching#self-hosting>

---

## Security & Vulnerability Management

### Current Status

**Last Audit:** April 19, 2026
**Total Issues Found:** 0 vulnerabilities
**Breakdown:**

- ✅ HIGH: 0
- ✅ MODERATE: 0
- ✅ CRITICAL: 0

### Remediation Applied

The audit noise that was breaking CI was removed with low-risk transitive dependency overrides in the root `package.json`:

```json
{
  "overrides": {
    "basic-ftp": "5.3.0",
    "yaml-language-server": {
      "yaml": "2.8.3"
    }
  }
}
```

#### Why this was safe

1. `basic-ftp` is only pulled transitively by `get-uri` in dev tooling, and `5.3.0` is the upstream patched release for the advisory affecting `<=5.2.2`.
2. `yaml-language-server` remained on the same package version already required by Astro tooling, but its nested `yaml` dependency was forced to `2.8.3`, which removes the vulnerable `2.7.1` copy without changing the workspace's public API surface.
3. No app/package source code was changed — only dependency resolution.

### Verification Commands

```bash
pnpm audit
pnpm audit --audit-level=high
```

Expected result:

```text
No known vulnerabilities found
```

### Ongoing Policy

- Keep the CI gate in `.github/workflows/test.yml` blocking `high` and `critical` issues.
- Keep the scheduled visibility workflow in `.github/workflows/security-audit.yml` generating artifacts for regression tracking.
- If a future advisory reappears through a transitive dependency, prefer a targeted `overrides` fix before attempting broad major-version upgrades.

---

### Security Best Practices

- ✅ **Automated Visibility** — Security audit workflows run in CI and publish artifacts
- ✅ **Lock Files** — Always commit `pnpm-lock.yaml`
- ✅ **Deterministic Tooling** — Use pinned `packageManager` + `rust-toolchain.toml`
- 🔍 **Monitor PRs** — GitHub dependabot can alert us to new vulnerabilities

For responsible disclosure and reporting policy, see `SECURITY.md`.

### Security Checks in CI/CD

Current strategy uses two layers:

- **Pipeline gate (`.github/workflows/test.yml`)**
  - `pnpm audit --audit-level=high`
  - Blocks PRs only for `high` and `critical`
- **Visibility workflow (`.github/workflows/security-audit.yml`)**
  - Manual run via `workflow_dispatch`
  - Weekly run via `schedule` (Monday, 09:00 UTC)
  - Generates full JSON audit artifact for tracking moderate issues

Repository baseline for bot automation (required by dependency update workflow):

- Actions workflow permissions: **Read and write permissions**
- Allow GitHub Actions to create/approve pull requests: **enabled**

To run the dedicated workflow manually:

1. Open GitHub Actions
2. Select **Security Audit**
3. Click **Run workflow**

### Reusable Workflow Building Blocks

To avoid duplicated scripting across workflows, the repository now provides reusable composite actions:

- **`.github/actions/npm-audit-report`**
  - Generates JSON + Markdown audit reports
  - Exposes vulnerability counters as outputs (`total`, `moderate`, `high`, `critical`)
- **`.github/actions/manage-issue`**
  - Creates or updates a tracked issue from a markdown file
  - Outputs `issue_url` and `proceed`
- **`.github/actions/create-pr`**
  - Standardized wrapper for PR creation in automation flows
- **`.github/workflows/reusable-security-audit.yml`**
  - Reusable workflow (`workflow_call`) for security gate + report + issue tracking
  - Called by `.github/workflows/security-audit.yml` and available for future workflows
- **`.github/workflows/reusable-dependency-update.yml`**
  - Reusable workflow (`workflow_call`) for check + issue management + update + PR creation
  - Called by `.github/workflows/dependency-updates.yml` and reusable for future bot-like update flows
- **`.github/workflows/reusable-release-health.yml`**
  - Reusable workflow (`workflow_call`) for release smoke checks (quality, build, security)
  - Opens/updates tracking issue on failure and publishes health report artifact
- **`.github/workflows/reusable-validate-docs.yml`**
  - Reusable workflow (`workflow_call`) for validating documentation (diagrams, locales, schemas)
  - Creates/updates tracking issue on scheduled/manual validation failures
- **`.github/workflows/release-health.yml`**
  - Wrapper workflow (manual + weekly schedule) that calls `reusable-release-health.yml`
- **`.github/workflows/validate-diagrams.yml`**
  - Wrapper workflow (PR/push/manual/weekly schedule) that calls `reusable-validate-docs.yml` for Mermaid diagram validation

Recommended reuse pattern for new workflows:

1. Generate a machine/human report file
2. Call `manage-issue` to create/update the tracking issue
3. If changes are needed, call `create-pr` to open/update PR automation

Wrapper and reusable interface conventions:

- Reusable workflows should expose stable, descriptive inputs (`artifact-name`, `report-file`, `issue-title`, `issue-search-query`, `issue-labels`).
- Wrapper workflows should call reusable workflows with explicit `with:` values, even when matching defaults, to keep intent visible.
- Schedule comments should always be in UTC and in English (for cross-team readability).
- Issue body templates should use token placeholders (for example `{{ISSUE_URL}}`) and be rendered in the reusable workflow.

### Governance References

For contributor-facing governance rules and repository-level protection setup, see:

- `docs/PR_QUALITY_GOVERNANCE.md` (policy: issue creation control, changeset requirements, quality gates)
- `docs/BRANCH_PROTECTION_SETUP.md` (how to configure required checks/approvals in GitHub)
- `CONTRIBUTING.md` (day-to-day contributor workflow)

Branch behavior summary:

- `main` / `develop`: strict push policy (failing checks block push)
- Feature branches: permissive push policy (warnings allowed, CI remains authoritative)

---

## Environment Validation

### Verify All Tools

Run this command to confirm everything is set up correctly:

```bash
pnpm run factory:preflight
```

**Expected Output:**

```
🧪 Refarm Factory Preflight
...
Summary
- failures: 0
- warnings: 0
Factory is ready for swarm execution.
```

### Tractor Runtime Readiness Probe

Use the Tractor CLI health probe to validate runtime boot and daemon WS readiness.

```bash
# 1) Optional: start daemon in another terminal
# cargo run -p refarm-tractor --bin tractor -- --namespace default --port 42000

# 2) Run readiness probe (boot + WS)
cargo run -p refarm-tractor --bin tractor -- health --ws-port 42000
```

Behavior:
- exit `0` when probe succeeds
- exit non-zero when daemon is unavailable or probe fails

Quick failure check (expected non-zero):

```bash
cargo run -p refarm-tractor --bin tractor -- health --ws-port 1 --skip-boot-probe
```

### Workspace Health Check

```bash
# Ensure dependencies are installed
pnpm install --frozen-lockfile

# Run turbo pipeline (if defined)
pnpm run build

# Run tests (if defined)
pnpm run test
```

### Colony preflight checklist (quick vs complete)

Quick preflight (sempre obrigatório):

```bash
node scripts/reso.mjs status
pnpm run project:validate
pnpm run factory:preflight
```

Complete preflight (runtime/security boundaries):

```bash
cd packages/tractor
cargo check --quiet
cargo test --lib agent_tools_bridge --quiet
cargo test --lib plugin_host --quiet
cargo test --lib wasi_bridge --quiet
pnpm run test:smoke:ws
```

Go/No-Go:

- **GO**: quick preflight verde; se houve mudança runtime boundary, complete preflight verde.
- **NO-GO**: qualquer falha de toolchain/targets/reso status impede lote paralelo.

### Type-check baseline snapshot (2026-04-24)

Command used:

```bash
pnpm run type-check --silent
```

Result summary:
- packages in scope: 41
- failures: 0
- warnings: only advisory Vite browser externalization notices during app build

Attack order/backlog (if regression appears):
1. Foundation: `config`, `toolbox`, `vtconfig`, `cli`
2. Runtime: `tractor-rs`, `tractor-ts`, `plugin-manifest`
3. Contracts/storage/sync: `effort/artefact/automation/*-contract-v1`,
   `storage-*`, `sync-*`

### Build baseline matrix by domain (2026-04-24)

| Domain | Canonical command | Status | Notes |
|---|---|---|---|
| Foundation | `pnpm run gate:smoke:foundation` | ✅ Green | `cli` type-check + tests de `config/toolbox/vtconfig` |
| Runtime | `pnpm run gate:smoke:runtime` | ✅ Green | `tractor-rs` smoke/build checks + `tractor-ts` build/type-check/runtime-module smoke |
| Contracts/Storage/Sync | `pnpm run gate:smoke:contracts` | ✅ Green | Builds + unit/conformance for effort, artefact, automation, storage, sync, identity, task, and session contracts |
| Colony Full | `pnpm run gate:full:colony` | ✅ Green (expected by composition) | Encadeia smoke por domínio, POCs sintéticas, manifests de artefatos + `project:validate` |

Dependências operacionais entre domínios:

- Foundation é base para tooling comum e deve ficar verde antes de ampliar paralelismo.
- Runtime depende de preflight completo (toolchain Rust/WASM + smoke WS).
- Contracts/Storage/Sync depende de baseline de contratos v1, suites de
  conformance, e validação de manifests de artefatos quando outputs esperados
  mudam.

Bloqueadores monitorados:

- Nenhum bloqueador técnico aberto neste snapshot para os domínios acima.
- `pnpm audit` moderado permanece **advisory** (0 high/critical).

### Colony concurrency baseline

Initial concurrency:
- default: **3 workers**
- max under stable CI: **4 workers**

Scale up when:
- 3 consecutive slices with smoke gate green
- zero unresolved merge collision in serialized packages
- CI quality lane remains green across 2 consecutive runs

Scale down when:
- any regression in protected branch checks
- repeated collision on serialized areas (`packages/tractor*`, `.project/**`, workflows)
- preflight complete starts failing intermittently

---

## Docker & Container Notes

### Docker Debug

The message about "Docker Debug" during post-create is **informational only**:

```
Try Docker Debug for seamless, persistent debugging tools in any container or image
→ docker debug 4f6c219414d6d46c22896fc40684a65f3163360874e3cecb757c4117e323841c
```

**What it means:**

- Docker suggests the `docker debug` command for inspecting live containers
- **You don't need to enable or configure this** — it's just a notification

**When to use it (optional):**

```bash
# If you ever need to debug the running container:
docker debug <container-id>
```

### Container Specs

- **Base Image:** `mcr.microsoft.com/devcontainers/typescript-node:22-bookworm`
- **Python (optional):** Available via apt if needed
- **Git:** Pre-installed
- **Build Tools:** gcc, make, pkg-config
- **Custom Extensions:** VS Code extensions defined in `.devcontainer/devcontainer.json`

### Volumes & Mounts

- `/workspaces/refarm` — Workspace root (mounted from host)
- `/home/vscode/.local/share/pnpm/store` — pnpm content-addressed store (persisted via Docker volume `refarm-pnpm-store`)

---

## Contributing to DevOps

If you update this guide or the dev container configuration:

1. **Update `.devcontainer/post-create.sh`** for automation changes
2. **Update `.devcontainer/post-start.sh`** for runtime sanity/self-healing changes
3. **Update `.devcontainer/devcontainer.json`** for container spec changes
4. **Update This File** (`docs/DEVOPS.md`) with any new information
5. **Commit** all changes together in a single PR

---

## Quick Reference

| Task | Command |
|------|---------|
| Rebuild container | `Dev Containers: Rebuild Container` (VS Code) |
| Factory readiness check | `pnpm run factory:preflight` |
| Tractor runtime readiness probe | `cargo run -p refarm-tractor --bin tractor -- health --ws-port 42000` |
| Run security audit | `pnpm audit` |
| Attempt non-breaking vulnerability fixes | `pnpm audit fix` |
| Clean pnpm store | `pnpm store prune` |
| Verify tools | See [Environment Validation](#environment-validation) |
| Install Rust lint/format parity tools | `rustup component add rust-src clippy rustfmt` |
| View container logs | `docker logs <container-id>` |
| Debug container | `docker debug <container-id>` (optional) |

---

**Last Updated:** April 22, 2026  
**Maintained By:** Refarm Team  
**Next Review:** Q2 2026 (security check)
