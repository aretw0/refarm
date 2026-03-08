# ADR-026: DevOps in Grand Style — Deployment and CI/CD Standards

**Date**: 2026-03-07
**Status**: Proposed
**Context**:
As we transition to a micro-kernel architecture and open the doors for third-party plugin developers, we need to provide a "path of least resistance" for high-quality engineering. Currently, there is No standard for how a plugin should be tested or how the Refarm host itself should be deployed onto the various "Sovereign" or "Cloud" platforms.

**Decision**:
We will implement a standardized DevOps "Starter Kit" for both Plugins and the Refarm Host (Homestead).

### 1. Plugin CI/CD ("The Conformance Gate")
Every plugin repository should include a GitHub Action that:
- **Builds**: Compiles the WASM component.
- **Validates**: Checks the `plugin-manifest` against the official schema.
- **Tests**: Runs the official Contract Conformance Suite (e.g., `storage-contract-v1`) against the plugin's code.
- **Integrity**: Generates a NIP-94-compatible SHA-256 hash.

### 2. Host Deployment ("Freedom of Residency")
The Refarm host (Homestead) must be deployable as a **Sovereign Application** with zero vendor lock-in.
- **Static First**: By default, Homestead is a static Astro app (Astro `static` output).
- **GitHub Pages**: Official "Grand Style" deploy target for community-led instances.
- **Vercel/Cloudflare**: Hybrid/SSR support via Astro Adapters for advanced users needing Edge features.
- **Button**: A "Deploy to..." button for GitHub repositories to fork-and-ship in one click.

### 3. Identity-Scoped Deployment
Deployments will be pre-configured to handle `refarm.dev.br` as the central discovery relay but will allow users to point to their own Nostr relays upon boot.

**Consequences**:
- **Positivas**: 
    - Ensures all community plugins are high-quality and cross-compatible.
    - Lowers the barrier to entry for users who want their own "Host".
    - Solidifies the "Refarm" brand as a reliable ecosystem.
- **Negativas**: 
    - Requires maintaining several GitHub Action workflow templates as "Source of Truth".
    - Requires continuous updates to the conformance test suites.

**Implementation**:
1. Create `.github/workflow-templates/plugin-ci.yml`.
2. Create `.github/workflows/deploy-homestead.yml`.
3. Update `apps/homestead/astro.config.mjs` for multi-adapter flexibility.
