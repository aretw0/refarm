# Repository Migration Guide: aretw0/refarm → refarm-dev/refarm

This guide outlines the steps for migrating the repository and setting up the new organization infrastructure.

## 1. GitHub Transfer

1. **Transfer Repository**: Use the GitHub UI to transfer `aretw0/refarm` to the `refarm-dev` organization.
2. **Rename (if necessary)**: Ensure the repository name remains `refarm`.
3. **Teams & Permissions**:
    - Create a `maintainers` team.
    - Create a `contributors` team.

## 2. NPM Organization Setup

Since we are moving to the `@refarm.dev` scope, we must ensure the NPM organization is ready.

### Token Management Policy
> [!IMPORTANT]
> To ensure maximum security and "housechores" integrity:
> - **Granular Access Tokens**: NEVER use classic "Automation" tokens. Use Granular tokens restricted to the `@refarm.dev` scope and specific IP ranges if possible.
> - **NPM Provenance**: All CI/CD workflows MUST use `--provenance`. This creates a verifiable link between the build in GitHub Actions and the package on NPM.

### Publishing Workflow
1. Create an NPM organization: `refarm.dev`.
2. Add a `NPM_TOKEN` (Granular) to GitHub Secrets for the `refarm-dev` org.

## 3. Local Developer Updates

After the transfer, developers need to update their local clones:

```bash
# Update the origin remote
git remote set-url origin https://github.com/refarm-dev/refarm.git

# Verify the change
git remote -v
```

## 4. CI/CD Configuration

Update `.github/workflows/` to point to the new organization and ensure secrets are available.
- Update `publish.yml` (if existing) or create the new one using the migration health check script as a gate.
- Ensure `NPM_TOKEN` is correctly referenced.

## 5. Post-Migration Verification

Run the migration health check script:
```bash
node scripts/migration-health-check.mjs
```

Everything should be green before the first official release under the new org.
