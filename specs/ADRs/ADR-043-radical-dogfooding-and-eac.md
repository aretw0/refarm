# ADR-043: Radical Dogfooding & Everything as Config (EaC)

**Status**: ✏️ DRAFT (Proposed)

## Context

The Refarm project aims for radical sovereignty, which extends beyond data to the very infrastructure that hosts it. We have identified a "drift" where CI/CD workflows and deployment scripts contain hardcoded values (repositories, URLs, provider-specific paths) that are not derived from the project's own configuration system.

To achieve the "Radical Ejection Right" (ADR-002), the project must be its own greatest representation of "dogfooding": everything that *can* be configured *must* be configured in the project's own Solo Fértil (Fertile Soil).

## Decision

1. **Everything as Config (EaC)**: `refarm.config.json` (and its future representation in the Sovereign Graph) is the single source of truth for:
    - Branding and Identity (slugs, names, scopes).
    - Infrastructure targets (Git host, deployment providers).
    - Provider-specific metadata (DNS Zone IDs, Custom Domains).
2. **Configuration as the Bridge**: The `@refarm.dev/config` package will be evolved from an Astro-specific helper into a universal bridge for all scripts, CI/CD pipelines, and internal tools.
3. **IaC Convergence**: Infrastructure changes (like updating a site URL or DNS record) must be driven by configuration changes. Deployment pipelines will include a "Convergence Step" that reconciles external provider state with the internal config state. We will leverage established tools like the `gh` CLI and Cloudflare's API batched operations to ensure reliable state transition.
4. **The Escape Hatch (Kill Switch)**: A dedicated, high-privilege pipeline will be maintained to automate mass migration between infrastructure providers. This will utilize repository mirroring (via `git --mirror`) and automated DNS migration tools.

## Consequences

### Positive
- **Total Portability**: Migrating the entire project to a new organization or host becomes a configuration change rather than a manual DevOps task.
- **Symmetry**: Development and production environments share the same configuration primitive.
- **Transparency**: Infrastructure state is versioned and visible alongside the source code.

### Negative
- **Complexity**: Early-stage configuration becomes more verbose.
- **Security Density**: The "Kill Switch" requires high-privilege tokens, increasing the "blast radius" of a potential secret leak.
- **Tooling Overhead**: Requires building and maintaining custom sync tools for provider APIs.

## Implementation Roadmap

1. **Universal Config**: Refactor `@refarm.dev/config` to be environment-agnostic.
2. **CI/CD Cleanup**: Audit all `.github/workflows` and replace hardcoded strings with config-derived variables.
3. **Provider Integration**: Implement `sync-infra.mjs` using Cloudflare and GitHub APIs.
4. **Migration Pipeline**: Create the `escape-hatch.yml` workflow.
