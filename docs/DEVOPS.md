# DevOps & Developer Setup Guide

> 🔧 **Environment Configuration, Security, and Development Infrastructure for Refarm**

---

## Table of Contents

- [Dev Container Setup](#dev-container-setup)
- [Security & Vulnerability Management](#security--vulnerability-management)
- [Environment Validation](#environment-validation)
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

### Manual Rebuild

If you need to rebuild the container:

```bash
# VS Code Command Palette (Ctrl+Shift+P)
> Dev Containers: Rebuild Container
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

---

## Security & Vulnerability Management

### Current Status

**Last Audit:** March 6, 2026
**Total Issues Found:** 6 vulnerabilities (1 HIGH, 5 MODERATE)
**Current Status After Fixes:** 4 MODERATE remaining (lodash dependency chain)

### Vulnerability Inventory

| Package | Severity | Issue | Status | Details |
|---------|----------|-------|--------|---------|
| **SVGO** | HIGH | DoS via entity expansion (Billion Laughs) | ✅ FIXED | `npm audit fix` resolved this; used in Astro |
| **Lodash** | MODERATE | Prototype Pollution in `_.unset()` & `_.omit()` | ⚠️ BLOCKED | Requires upstream Astro/yaml-language-server update |

### Why Lodash Remains

The lodash vulnerability is **deep in the Astro dependency chain**:

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
   - Monitor https://github.com/withastro/language-tools/issues

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

### Security Best Practices

- ✅ **Automatic Audits** — `npm audit fix --force` runs in post-create
- ✅ **Lock Files** — Always commit `package-lock.json`
- ✅ **Regular Updates** — npm is auto-updated in post-create hook
- 🔍 **Monitor PRs** — GitHub dependabot can alert us to new vulnerabilities

### Security Checks in CI/CD

Current strategy uses two layers:

- **Pipeline gate (`.github/workflows/test.yml`)**
  - `npm audit --audit-level=high`
  - Blocks PRs only for `high` and `critical`
- **Visibility workflow (`.github/workflows/security-audit.yml`)**
  - Manual run via `workflow_dispatch`
  - Generates full JSON audit artifact for tracking moderate issues

To run the dedicated workflow manually:

1. Open GitHub Actions
2. Select **Security Audit**
3. Click **Run workflow**

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
