# DevOps & Developer Setup Guide

> 🔧 **Environment Configuration, Security, and Development Infrastructure for Refarm**

---

## Table of Contents

- [Dev Container Setup](#dev-container-setup)
- [Security & Vulnerability Management](#security--vulnerability-management)
- [Environment Validation](#environment-validation)
- [CI Caching Strategy](#ci-caching-strategy)
- [Docker & Container Notes](#docker--container-notes)

---

## Dev Container Setup

### Overview

Refarm uses **VS Code Dev Containers** to provide a consistent, reproducible development environment across all contributors.

**Environment Details:**

- **Base:** Debian GNU/Linux 12 (bookworm)
- **Node.js:** v22.16.0
- **npm:** 10.9.2 (auto-updated to latest during post-create)
- **Rust:** 1.94.0
- **Cargo:** 1.94.0

### Automatic Setup

When opening the workspace in VS Code with the Remote Containers extension:

1. **Container Build** — Docker builds the image from `.devcontainer/devcontainer.json`
2. **Post-Create Hook** — Executes `.devcontainer/post-create.sh`:
   - Fixes npm cache permissions (prevents EACCES errors)
   - Updates npm to latest stable version
   - Installs Rust WASM targets (`wasm32-unknown-unknown`, `wasm32-wasip1`)
   - Installs cargo tools: `cargo-component`, `wasm-tools`
   - Runs `npm ci` to install workspace dependencies
   - Runs `npm audit fix --force` to remediate known vulnerabilities

### Devcontainer Image Baseline (Tracked)

Refarm now uses a repo-local build file: `.devcontainer/Dockerfile`.

Purpose:

- Keep system-level dependencies versioned in Git
- Ensure fresh container builds already support diagram generation (`npm run diagrams:fix`)
- Avoid one-off manual apt installs that are lost on rebuild

Current image-level dependencies explicitly tracked in Dockerfile:

- Mermaid CLI/headless Chromium runtime libraries:
  - `libdbus-1-3`, `libatk1.0-0`, `libatk-bridge2.0-0`, `libcups2`, `libnss3`
  - `libx11-xcb1`, `libxcomposite1`, `libxdamage1`, `libxfixes3`, `libxrandr2`
  - `libgbm1`, `libpango-1.0-0`, `libcairo2`, `libasound2`, `libatspi2.0-0`, `libgtk-3-0`

Mermaid design system baseline:

- Global style configuration file: `specs/diagrams/mermaid.config.json`
- Diagram generation script (`scripts/check-diagrams.mjs`) always passes this config to Mermaid CLI
- Any style changes must be applied in this file, then regenerated via `npm run diagrams:fix`

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
npm run diagrams:fix
npm run test:unit
```

### Troubleshooting

**Issue: `npm error EACCES` in post-create**

- **Cause:** npm cache contains root-owned files
- **Fix:** Already handled in `post-create.sh` (runs `sudo chown -R 1001:1001 /home/vscode/.npm`)
- **Manual workaround:** `rm -rf ~/.npm && npm cache clean --force`

**Issue: Package installation failures**

- **Cause:** Stale node_modules or package-lock.json mismatch
- **Fix:** Delete both and reinstall:

  ```bash
  rm -rf node_modules package-lock.json
  npm install
  ```

**Issue: Mermaid/Chromium fails with missing shared library**

- **Symptom:** `npm run diagrams:fix` fails with `error while loading shared libraries: <libname>.so`
- **Root cause:** devcontainer image missing required runtime library for headless Chromium
- **Fix process:**
  1. Add missing package to `.devcontainer/Dockerfile`
  2. Rebuild container
  3. Re-run `npm run diagrams:fix`
  4. Document dependency update in this DevOps guide

**Issue: GitHub Actions fails with `Unrecognized named-value: 'steps'` in `uses:`**

- **Symptom:** Workflow validation fails on lines like:

  ```yaml
  uses: actions/upload-artifact@${{ steps.setup.outputs.upload-artifact-version }}
  ```

- **Root cause:** `uses:` does not support runtime expressions for action version refs in workflow syntax. The ref must be static at parse time.
- **Fix applied (Mar 6, 2026):** Replaced expression-based refs with local wrapper actions:
  - `./.github/actions/upload-artifact` (internally pinned to `actions/upload-artifact@v7.0.0`)
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
- **Additional correction:** Simplified `./.github/actions/setup` to only configure Node + `npm ci` (checkout moved to workflows/jobs).
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

- **Symptom:** `astro build` fails pointing to `apps/studio/src/pages/dev.astro` with `Unexpected "const"`.
- **Root cause:** TypeScript sample code was embedded directly inside `<textarea>...</textarea>` in an Astro template. Curly braces and template interpolation tokens (`{}`, `${}`) inside that inline block were interpreted by the Astro parser.
- **Fix applied (Mar 6, 2026):** Moved sample editor content to a frontmatter string (`defaultPluginCode`) and rendered it via `{defaultPluginCode}` in the textarea.
- **Additional correction:** Replaced TypeScript-only syntax in inline `<script>` with plain JavaScript (`!`, type annotations, and `as` assertions removed).
- **Verification:** `npm run build -w @refarm/studio` succeeds locally.

**Warning: "The CJS build of Vite's Node API is deprecated" in Git Hooks**

- **Symptom:** Git pre-push hook logs show repeated deprecation warning:

  ```
  The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.
  ```

- **Root cause:** Vitest internally uses Vite's CommonJS API instead of ESM API. This occurs specifically during `npm run test:unit` when Vitest initializes, not during lint or type-check commands.

- **Impact:** Purely cosmetic; does not affect test functionality or results. Clutters git hook output making it harder to spot actual issues.

- **Investigation process (Mar 6, 2026):**
  1. **Initial attempt:** Added `export VITE_CJS_IGNORE_WARNING=true` environment variable to hook.
     - **Result:** Failed. Vite doesn't respect this env var consistently across all contexts.
  
  2. **Discovery:** Ran hook commands individually:
     - `npm run lint` → ✅ No warning
     - `npm run type-check` → ✅ No warning  
     - `npm run test:unit` → ❌ Warning appears (Vitest loads Vite)
  
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
    - `npm run lint 2>&1 | filter_vite_warning`
    - `npm run type-check 2>&1 | filter_vite_warning`
    - `npm run test:unit 2>&1 | filter_vite_warning`

- **Why grep filter instead of env var:**
  - More reliable: works regardless of how Vite is configured internally
  - Surgical: only removes this specific message, preserves all other warnings/errors
  - Maintainable: easy to update pattern if message changes

- **Long-term resolution:** Will be resolved when Vitest ecosystem fully migrates to Vite's ESM API (upstream dependency work).

- **Verification:**

  ```bash
  npm run hooks:install  # Reinstall hook with filter
  .git/hooks/pre-push 2>&1 | grep -c "CJS build"  # Should return 0
  ```

- **Files modified:**
  - `scripts/install-git-hooks.mjs` - Added filter function and applied to all npm commands

---

## CI Caching Strategy

### Current Baseline (March 6, 2026)

- **Dependency cache:** `actions/setup-node` with `cache: npm` in `./.github/actions/setup`.
- **Build reuse across jobs:** `build` job uploads `workspace-build` artifact; `e2e` job downloads it instead of rebuilding.
- **Playwright browser cache:** `e2e` caches `~/.cache/ms-playwright` using key `${{ runner.os }}-playwright-${{ hashFiles('package-lock.json') }}`.
- **E2E placeholder short-circuit:** `e2e` is skipped when root `test:e2e` script is still the placeholder (`No E2E tests configured yet`).

### Invalidation Rules

- **npm cache invalidates when:** Node version or lockfile changes.
- **Playwright cache invalidates when:** `package-lock.json` hash changes or runner OS changes.
- **Build artifact invalidates when:** a new workflow run executes (artifact is per-run, retention 7 days).

### Why This Avoids Waste

- Prevents duplicate `npm run build` in both `build` and `e2e` jobs.
- Avoids repeated Playwright browser downloads when lockfile/OS are unchanged.
- Avoids running E2E setup and report upload while suite is not yet implemented.

### Residual Cost (Expected)

- `npm ci` still runs once per job due job isolation on hosted runners.
- Further reduction would require remote cache for task outputs (for example Turbo remote cache with `TURBO_TOKEN`/`TURBO_TEAM`).

### Future: Turbo Remote Cache

**Status:** Not yet configured (awaiting credentials/team setup)

**What It Provides:**

Turbo remote cache allows task output reuse across different CI runs and machines. Instead of rebuilding/retesting on every workflow run, Turbo checks if inputs (source files, dependencies) match a previous run and restores outputs (build artifacts, test results) from remote storage.

**Expected Benefits:**

- **Cross-run cache hits:** If code/dependencies haven't changed, `turbo run build test lint` skips actual execution and restores cached outputs.
- **Parallel developer cache sharing:** Local dev builds can reuse CI outputs and vice-versa.
- **Reduced CI minutes:** Jobs skip redundant tasks when commit doesn't affect relevant workspaces.

**Prerequisites:**

- Turbo account with remote cache enabled (Vercel platform or self-hosted remote cache server).
- `TURBO_TOKEN` secret added to repository settings (GitHub Actions secrets).
- `TURBO_TEAM` configured (organization/team slug).

**Configuration Steps (When Available):**

1. **Add secrets to GitHub repository:**
   - Navigate to repository Settings → Secrets and variables → Actions
   - Add `TURBO_TOKEN` (from Vercel dashboard or remote cache provider)
   - Add `TURBO_TEAM` (team identifier, e.g., `refarm-team`)

2. **Update workflow environment variables:**
<<<<<<< HEAD
=======

>>>>>>> 95da43e (docs(devops): add Turbo remote cache future configuration guide)

   ```yaml
   env:
     TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
     TURBO_TEAM: ${{ secrets.TURBO_TEAM }}
   ```

   Add to `.github/workflows/test.yml` at job or workflow level.

1. **Verify turbo.json cache configuration:**
   - Ensure `turbo.json` has proper `outputs` declared for each task.
   - Current config already specifies outputs for `build`, `test`, and `lint` tasks.

2. **Test remote cache:**
   - Run workflow twice with identical code.
   - Second run should show `>>> FULL TURBO` with cache hits from remote.
   - Check Turbo dashboard for cache hit statistics.

**Cost Consideration:**

- Vercel remote cache has free tier (limited cache storage/bandwidth).
- Exceeding limits requires paid plan or self-hosted cache server.
- Monitor usage via Vercel dashboard or remote cache provider metrics.

**Documentation:**

- Official guide: <https://turbo.build/repo/docs/core-concepts/remote-caching>
- Self-hosted setup: <https://turbo.build/repo/docs/core-concepts/remote-caching#self-hosting>

---

## Security & Vulnerability Management

### Current Status

**Last Audit:** March 6, 2026 (Updated)
**Total Issues Found:** 11 MODERATE vulnerabilities
**Breakdown:**

- ✅ HIGH: 0 (all fixed)
- ⚠️ MODERATE: 11 (mostly from Vitest + Lodash chains, non-runtime)
- 🟢 CRITICAL: 0

### Vulnerability Inventory

| Package | Severity | Issue | Status | Introduced By | Notes |
|---------|----------|-------|--------|---------------|-------|
| **esbuild** | MODERATE | Arbitrary code execution in dev server | ⚠️ TOOLING-ONLY | vitest + @vitest/coverage-v8 | Dev-only dependency; no runtime impact; fix requires Vitest@4.0+ (major upgrade) |
| **vite** | MODERATE | Depends on vulnerable esbuild | ⚠️ TOOLING-ONLY | vitest → vite-node → vite | Transitive; blocked on esbuild fix |
| **@vitest/mocker** | MODERATE | Depends on vulnerable vite | ⚠️ TOOLING-ONLY | vitest | Transitive; blocked on vite fix |
| **Lodash** | MODERATE | Prototype Pollution in `_.unset()` & `_.omit()` | ⚠️ BLOCKED | @astrojs/language-server → yaml-language-server | Indirect; dev tooling only; awaiting upstream Astro team fix |
| **inflight** | MODERATE | Memory leak (deprecated package) | ⚠️ DEPRECATION | glob (transitive) | No longer maintained; impacts glob v10.5.0; consider upgrades to glob v11+ |
| **glob** | MODERATE | Uses deprecated inflight | ⚠️ DEPRECATION | node dependencies | Old glob version; npm warns on update |

### Why These Remain (Rationale & Acceptance)

#### esbuild + Vitest Chain

**Chain:**

```
esbuild (vulnerable: arbitrary code in dev server)
  ← vite
    ← vitest + @vitest/coverage-v8 (NEWLY INSTALLED March 6, 2026)
```

**Decision:** Accept temporarily.

**Reasoning:**

1. esbuild vulnerability is **development-only** — no impact on production code or built artifacts
2. Vitest was installed as part of test infrastructure unification (replacing Jest)
3. Fix requires upgrading Vitest to v4.0+, which is a breaking change and needs testing
4. Current version (v2.1.9) is stable and used in production projects

**Timeline:**

- Monitor for Vitest v4 LTS release
- Plan upgrade alongside other major version bumps
- Target: Q2 2026 (after v0.1.0 MVP ships)

#### Lodash (Existing)

```
lodash (vulnerable)
  ← yaml-language-server
    ← volar-service-yaml
      ← @astrojs/language-server
        ← @astrojs/check
```

#### Solutions Available

1. **Wait for Upstream** — Astro team will update dependencies
   - Lowest risk, no action needed from us
   - Monitor <https://github.com/withastro/language-tools/issues>

2. **Pin Safe Version Override** (If needed)

   ```json
   {
     "overrides": {
       "lodash": "^4.17.21-4"
     }
   }
   ```

3. **Monitor Actively**

   ```bash
   npm audit --audit-level=moderate
   ```

### Risk Acceptance Policy (All Moderate Issues)

**Core Principle:** Accept MODERATE tooling-dev dependencies if:

1. ✅ Severity ≤ MODERATE (no HIGH/CRITICAL)
2. ✅ Runtime isolation: dev-only or indirect (no direct code path to production)
3. ✅ Alternatives exist but have trade-offs (major version bumps, breaking changes, unmaintained upstream)
4. ✅ CI gate for HIGH/CRITICAL remains enforced

**Tracking & Reviews:**

- **Weekly:** `npm audit` check in security workflow (automated)
- **Per PR:** CI gate blocks HIGH/CRITICAL (automated)
- **Manual:** Full audit report generated monthly (`.github/workflows/security-audit.yml`)
- **Escalation:** If any issue moves to HIGH/CRITICAL, open urgent issue

**Monitoring Dashboard:**

Current snapshot (March 6, 2026):

```
┌─────────────────────────────────────────┐
│  Vulnerability Trend                    │
├─────────────────────────────────────────┤
│ HIGH/CRITICAL:     0  (target: always 0) │
│ MODERATE:         11  (from 4 on 3/6)    │
│ - Vitest (new):    6  (introduced 3/6)  │
│ - Lodash (old):    1  (since before)     │
│ - Deprecation:     4  (glob/inflight)    │
├─────────────────────────────────────────┤
│ Threshold: Accept if all conditions met  │
│ Last review: 2026-03-06T16:45:00Z        │
│ Next target: 2026-03-13 (weekly check)   │
└─────────────────────────────────────────┘
```

**Acceptance Criteria (All must remain true):**

For **esbuild + Vitest chain**:

- [ ] Severity stays at MODERATE (no escalation to HIGH)
- [ ] No active exploits reported against Vitest versions we use
- [ ] Vitest v4 LTS becomes available (planned mid-2026)
- [ ] Commit esbuild fix to upgrade cycle roadmap

For **Lodash (existing)**:

- [ ] Severity stays at MODERATE
- [ ] Dependency stays indirect (yaml-language-server → Astro)
- [ ] No production code uses lodash directly
- [ ] Monitor Astro/TypeScript tooling updates monthly

If **any** acceptance criteria fails:

- Immediately escalate in #security channel
- Create blocking issue
- Plan emergency upgrade or mitigation

---

### Security Best Practices

- ✅ **Automatic Audits** — `npm audit fix --force` runs in post-create
- ✅ **Lock Files** — Always commit `package-lock.json`
- ✅ **Regular Updates** — npm is auto-updated in post-create hook
- 🔍 **Monitor PRs** — GitHub dependabot can alert us to new vulnerabilities

For responsible disclosure and reporting policy, see `SECURITY.md`.

### Security Checks in CI/CD

Current strategy uses two layers:

- **Pipeline gate (`.github/workflows/test.yml`)**
  - `npm audit --audit-level=high`
  - Blocks PRs only for `high` and `critical`
- **Visibility workflow (`.github/workflows/security-audit.yml`)**
  - Manual run via `workflow_dispatch`
  - Weekly run via `schedule` (Monday, 09:00 UTC)
  - Generates full JSON audit artifact for tracking moderate issues

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
echo "=== Environment Validation ===" && \
node --version && \
npm --version && \
rustc --version && \
cargo --version && \
cargo-component --version && \
wasm-tools --version && \
echo "✅ All tools ready!"
```

**Expected Output:**

```
=== Environment Validation ===
v22.16.0
v11.x.x (or higher)
rustc 1.94.0 ...
cargo 1.94.0 ...
cargo-component 0.21.1
wasm-tools 1.245.1
✅ All tools ready!
```

### Workspace Health Check

```bash
# Ensure dependencies are installed
npm ci

# Run turbo pipeline (if defined)
npm run build

# Run tests (if defined)
npm run test
```

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
- `/home/vscode/.npm` — npm cache (persistent during session)
- `/home/vscode/.npm/_cacache` — npm package cache (requires proper permissions)

---

## Contributing to DevOps

If you update this guide or the dev container configuration:

1. **Update `.devcontainer/post-create.sh`** for automation changes
2. **Update `.devcontainer/devcontainer.json`** for container spec changes
3. **Update This File** (`docs/DEVOPS.md`) with any new information
4. **Commit** all changes together in a single PR

---

## Quick Reference

| Task | Command |
|------|---------|
| Rebuild container | `Dev Containers: Rebuild Container` (VS Code) |
| Run security audit | `npm audit` |
| Fix vulnerabilities | `npm audit fix --force` |
| Clean npm cache | `rm -rf ~/.npm && npm cache clean --force` |
| Verify tools | See [Environment Validation](#environment-validation) |
| View container logs | `docker logs <container-id>` |
| Debug container | `docker debug <container-id>` (optional) |

---

**Last Updated:** March 6, 2026  
**Maintained By:** Refarm Team  
**Next Review:** Q2 2026 (security check)
