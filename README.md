<!-- HEADER / BANNER -->
<div align="center">
  <img src="https://img.icons8.com/fluency/96/000000/tree-structure.png" alt="Refarm Logo" width="90" />
  
  <h1>Refarm</h1>
  <p><b>Personal Operating System for Sovereign Data</b></p>
  
  [![Website](https://img.shields.io/badge/Website-refarm.dev-000000?style=flat-square&logo=google-chrome&logoColor=white)](https://refarm.dev)
  [![Patreon](https://img.shields.io/badge/Support_our_Hackerspace-Patreon-FF424D?style=flat-square&logo=patreon)](https://www.patreon.com/cw/refarm88)
  [![GitHub Sponsors](https://img.shields.io/badge/Sponsor-GitHub-EA4AAA?style=flat-square&logo=github)](https://github.com/sponsors/aretw0)
  [![License](https://img.shields.io/github/license/aretw0/refarm.svg?color=red)](LICENSE)
</div>

> **Personal Operating System for Sovereign Data**

A experimental system to claim ownership of your data. Centralises data from multiple fragmented sources into a single, offline-first, portable graph that belongs entirely to you.

---

## Why This Matters

Most digital life scatters across dozens of platforms. Your data lives inside corporate servers, bound by terms-of-service, inaccessible when you need it, gone when you don't.

**Refarm's hypothesis**: What if you could own, control, and transport your data like you own your files?

We're exploring this through:

- **Offline-first storage** — data lives in your browser, not corporate servers
- **Plugin architecture** — extend via client-side WASM, fully agnostic of registries
- **Open formats** — everything is JSON-LD, portable to any platform
- **Pragmatic decentralisation** — Designed for agnostic identity & discovery; future-proof for protocols like Nostr, while maintaining local-first simplicity.

---

## The Sovereign Ecosystem

Refarm is a unified architecture that manifests as distinct experiences depending on the domain used to access it. All domains run the same core engine but curate different capabilities:

- **`refarm.dev`**: The core engine, SDKs, and developer portal.
- **`refarm.me`**: The sovereign identity and private "Second Brain" interface.
- **`refarm.social`**: The public network, federated communities, and P2P gardens.

---

## Status

🌱 **Maturing toward cohesion — creator as first user**

The core engine is built. The current focus is on becoming a real daily driver before any public release: consolidating the primitives into a cohesive system the creator uses for their own life and work. No v0.1.0 release until it earns that trust.

- **Current phase**: Phase 6 — Sync & Execution Stabilization (Loro CRDT, WASM Plugins, dual-runtime Tractor)
- **Pre-release gate**: creator daily-driver validation — Tractor + Homestead + stream contract working end-to-end
- **Registry maturity**: Tracking ready-to-publish packages in [Package Registry](packages/README.md) (44 packages)
- **Methodology**: [SDD → BDD → TDD → DDD](docs/WORKFLOW.md)

---

## 🗺 Sovereign Navigation Map

Categorized entry points for users, developers, and auditors.

### 🏛 Philosophy & Arch
- **[Architecture](docs/ARCHITECTURE.md)** — Core design principles and Evolutionary Roadmap.
- **[Knowledge Map](docs/INDEX.md)** — The "Architecture of Truth" (Master Index).
- **[ADRs](specs/ADRs/README.md)** — Architectural Decision Records.

### 🛠 Development & Ops
- **[Sovereign Workflow](docs/WORKFLOW.md)** — The SDD→BDD→TDD→DDD process.
- **[DevOps & Setup](docs/DEVOPS.md)** — Environment, CI, and Reusable Workflows.
- **[Package Registry](packages/README.md)** — List of all 44 packages and their publishing maturity.

### 🛡 Governance & Security
- **[PR Quality Governance](docs/PR_QUALITY_GOVERNANCE.md)** — Quality gates and changeset policy.
- **[Security Policy](SECURITY.md)** — Disclosure and operational status.
- **[Agent Rules](AGENTS.md)** — Rules of engagement for AI collaborators.

### 📊 Status & Roadmap
- **[Main Roadmap](roadmaps/MAIN.md)** — v0.1.0 through v1.0.0 milestones.
- **[Research Archive](docs/research/INDEX.md)** — Historical technical feasibility studies.

---

## Getting Started

```bash
npm install

# Development
npm run dev       # Watch mode for all apps
npm run build     # Build all packages
npm test          # Run tests

# Contribution workflow
npm run changeset # Create version changelog entry
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

---

## Contributing & Security

- **How to contribute:** [CONTRIBUTING.md](CONTRIBUTING.md)
- **PR quality policy:** [docs/PR_QUALITY_GOVERNANCE.md](docs/PR_QUALITY_GOVERNANCE.md)
- **Security policy & disclosure:** [SECURITY.md](SECURITY.md)
- **Security operational status (audit/dependencies):** [docs/DEVOPS.md](docs/DEVOPS.md)
- **License:** [AGPL-3.0](LICENSE)

---

## Further Reading

- [Full Architecture Document](docs/ARCHITECTURE.md)
- [Development Workflow](docs/WORKFLOW.md)
- [Main Roadmap](roadmaps/MAIN.md)
- [Research Validations](docs/research/)
