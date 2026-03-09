# Refarm Release & Versioning Policy

As the Refarm ecosystem expands across multiple domains (`@refarm.dev`, `@refarm.me`, `@refarm.social`), the pace of development must reflect the critical nature of sovereignty and security.

This policy defines the cadence, security, and velocity for different layers of the ecosystem.

## 1. The Core Kernel (`@refarm.dev/*`)
**Velocity Strategy: Slow, Deliberate, and Immutable.**

The Tractor, Heartwood, and base Contracts (`-contract-v1`) are the foundation of user sovereignty. A bug here compromises all data.

- **Cadence**: Infrequent. Changes require architectural validation (ADRs).
- **Versioning**: Strict Semantic Versioning. Breaking changes to capability contracts require a new package (e.g., `storage-contract-v2`).
- **Release Security**:
  - Scripts like `release.mjs` only prepare a local environment. They enforce clean git states, build outputs, and capability test compliance.
  - They **never** publish directly. They create a signed Git tag.
  - The actual NPM/Registry publish happens exclusively via GitHub Actions CI/CD after manual approval and passing all matrix tests.

## 2. Official Apps (`@refarm.me/*`, `@refarm.social/*`)
**Velocity Strategy: Measured & User-Centric.**

Apps like Homestead or Antenna are the user interfaces. They move faster than the kernel but must maintain unbreakable trust.

- **Cadence**: Sprint-based (e.g., bi-weekly or monthly).
- **Versioning**: Uses `Changesets`. Every PR must contain a changeset explicitly detailing what visual or behavioral change occurred.
- **Release Security**: Automated deployments (Vercel/Netlify for Web, Tauri pipelines for Desktop) triggered by `main` branch tags.

## 3. Plugins (The Ecosystem)
**Velocity Strategy: Move Fast and Break Things (Safely).**

Plugins are where the ecosystem breathes. Because Tractor enforces capability contracts and isolates them in WASM sandboxes, a bad plugin cannot corrupt the graph or steal keys.

- **Cadence**: Immediate / Continuous.
- **Versioning**: Up to the plugin author.
- **Release Security**: Handled by the developer. Refarm Homestead will provide a `Publish Plugin` button that signs the WASM blob with the developer's Nostr key, creating a verifiably authentic release on the decentralised registry.

## Security of `npm run release`
Our local `npm run release` script is a **Preparation Tool**, not a deployment tool.

1. It blocks execution if the git working tree is dirty.
2. It bumps the version locally.
3. It runs `type-check`, `build`, and `test:capabilities` (checking backwards compatibility).
4. It runs `npm publish --dry-run` to ensure the package configuration is valid.
5. If anything fails, it automatically rolls back the `package.json`.
6. If successful, it commits and tags the code, instructing the developer to `git push origin <tag>`.

The actual registry release only happens on the CI server.
