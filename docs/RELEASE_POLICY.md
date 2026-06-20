# Refarm Release & Versioning Policy

As the Refarm ecosystem expands across multiple domains and scope profiles (personal/org), the pace of development must reflect the critical nature of sovereignty and security.

This policy defines the cadence, security, and velocity for different layers of the ecosystem.

## 1. The Core Kernel (`@refarm.dev/*`)
**Velocity Strategy: Slow, Deliberate, and Immutable.**

Refarm now owns a dedicated release policy engine in `packages/release-engine` with
neutral defaults. Refarm-specific semantics are declared in `.refarm/config.json` under
`releasePolicy`, so decisions stay in our embedded configuration layer instead of in the
engine package itself. Both `vault-seed` and `agents-lab` should consume their own intentional
`releasePolicy` blocks (can copy/evolve this shape) as soon as their policy surface is aligned.

Daily-driver probes:

- `refarm release plan --selection default --json` shows the configured daily-driver release selection.
- `refarm release plan --tag kernel-contract --json` shows the wider kernel contract surface.
- `refarm agent --json` and `refarm agent finish --templates --json` expose release policy probes as read-only handoffs for agents and external workspaces.

Package release posture is tracked in
[`RELEASE_KERNEL_INVENTORY.md`](RELEASE_KERNEL_INVENTORY.md). Treat that
inventory as the current source for whether a package is a kernel contract,
kernel primitive, reference implementation, daily-driver surface, or lab/internal
surface before adding release policy entries.

The Tractor, Heartwood, and base Contracts (`-contract-v1`) are the foundation of user sovereignty. A bug here compromises all data.

- **Cadence**: Infrequent. Changes require architectural validation (ADRs).
- **Versioning**: Strict Semantic Versioning. Breaking changes to capability contracts require a new package (e.g., `storage-contract-v2`).
- **Pre-publish baseline**: Packages that have not reached npm yet should be
  treated as still defining their first public artifact. Do not stack patch or
  minor changesets that imply prior registry history; fold first-release contract
  refinements into the initial-release changeset, or reset the package baseline
  before release preparation.
- **Release Security**:
  - Scripts like `release.mjs` only prepare a local environment. They enforce clean git states, build outputs, and capability test compliance.
  - They **never** publish directly. They create a signed Git tag.
  - The actual NPM/Registry publish happens exclusively via GitHub Actions CI/CD after manual approval and passing all matrix tests.

## 2. Official Apps (active scope profile)
**Velocity Strategy: Measured & User-Centric.**

Apps like Homestead or Antenna are the user interfaces. They move faster than the kernel but must maintain unbreakable trust.

- **Cadence**: Sprint-based (e.g., bi-weekly or monthly).
- **Versioning**: Uses `Changesets`. Every PR must contain a changeset explicitly detailing what visual or behavioral change occurred.
- **Release Security**: Automated deployments (Vercel/Netlify for Web, Electron pipelines for Desktop) triggered by `main` branch tags.

## 3. Plugins (The Ecosystem)
**Velocity Strategy: Move Fast and Break Things (Safely).**

Plugins are where the ecosystem breathes. Because Tractor enforces capability contracts and isolates them in WASM sandboxes, a bad plugin cannot corrupt the graph or steal keys.

- **Cadence**: Immediate / Continuous.
- **Versioning**: Up to the plugin author.
- **Release Security**: Handled by the developer. Refarm Homestead will provide a `Publish Plugin` button that signs the WASM blob with the developer's Nostr key, creating a verifiably authentic release on the decentralised registry.

## Security of `pnpm run release`
Our local `pnpm run release` script is a **Preparation Tool**, not a deployment tool.

Before preparing a package-specific release, run `pnpm run release:readiness:plan`
to inspect the first-release gate sequence, then `pnpm run release:readiness`
when the local environment should prove npm/crates/workflow readiness end to end.
This gate composes existing checks instead of minting a second release policy.

1. It blocks execution if the git working tree is dirty.
2. It bumps the version locally.
3. It runs `type-check`, `build`, and `test:capabilities` (checking backwards compatibility).
4. It runs `pnpm publish --dry-run` to ensure the package configuration is valid.
5. If anything fails, it automatically rolls back the `package.json`.
6. If successful, it commits and tags the code, instructing the developer to `git push origin <tag>`.

The actual registry release only happens on the CI server.
