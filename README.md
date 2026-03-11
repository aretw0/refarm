# Refarm

[![License](https://img.shields.io/github/license/refarm-dev/refarm.svg?color=red)](LICENSE)

> **Personal Operating System for Sovereign Data**

A experimental system to claim ownership of your data. Centralises data from multiple fragmented sources into a single, offline-first, portable graph that belongs entirely to you.

---

## Why This Matters

Most digital life scatters across dozens of platforms. Your data lives inside corporate servers, bound by terms-of-service, inaccessible when you need it, gone when you don't.

**Refarm's hypothesis**: What if you could own, control, and transport your data like you own your files?

We're exploring this through:

- **Offline-first storage** — data lives in your browser, not corporate servers
- **Plugin architecture** — extend via client-side WASM, not cloud APIs
- **Open formats** — everything is JSON-LD, portable to any platform
- **Pragmatic decentralisation** — Nostr for identity, not email for verification

---

## The Sovereign Ecosystem

Refarm is a unified architecture that manifests as distinct experiences depending on the domain used to access it. All domains run the same core engine but curate different capabilities:

- **`refarm.dev`**: The core engine, SDKs, and developer portal.
- **`refarm.me`**: The sovereign identity and private "Second Brain" interface.
- **`refarm.social`**: The public network, federated communities, and P2P gardens.

---

## Status

🚧 **In active research & development**

- **Current phase**: Semana 0 - Pre-Sprint readiness completed (Architecture, QA Gates, CI/CD)
- **Next milestone**: v0.1.0 Sprint 1 SDD (Spec Driven Development)
- Architecture defined via [ADRs](specs/ADRs/)
- Core flow: [SDD → BDD → TDD → DDD](docs/WORKFLOW.md)
- Readiness tracking: [Pre-Sprint Checklist](docs/pre-sprint-checklist.md)
- Feedback welcome; production use not recommended yet

---

## Project Structure

**Apps:**

- `apps/tractor` — Core orchestration and plugin host
- `apps/homestead` — Web IDE for managing data and plugins

**Packages** (reusable libraries):

- `packages/storage-sqlite` — Offline storage with SQLite + OPFS
- `packages/identity-nostr` — Sovereign identity via Nostr
- `packages/sync-crdt` — Real-time sync with CRDT

**Documentation:**

- [Pre-Sprint Checklist](docs/pre-sprint-checklist.md) — Current readiness status for Sprint 1
- [Architecture Guide](docs/ARCHITECTURE.md) — System design
- [Workflow Guide](docs/WORKFLOW.md) — Development process (SDD→BDD→TDD→DDD)
- [DevOps & Setup](docs/DEVOPS.md) — Environment, CI, and reusable workflow operations
- [PR Quality Governance](docs/PR_QUALITY_GOVERNANCE.md) — Quality gates, issue control, and changeset policy
- [Branch Protection Setup](docs/BRANCH_PROTECTION_SETUP.md) — Practical GitHub branch rule configuration
- [Research & Validation](docs/research/INDEX.md) — Technical feasibility studies
- [ADRs](specs/ADRs/README.md) — Architecture decisions
- [Roadmap](roadmaps/MAIN.md) — v0.1.0 through v1.0.0 milestones

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
