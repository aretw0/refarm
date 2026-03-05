# Refarm

[![License](https://img.shields.io/github/license/aretw0/refarm.svg?color=red)](LICENSE)

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

## Status

🚧 **In active research & development**

- Architecture defined via [ADRs](docs/specs/ADRs/)
- Core flow: [SDD → BDD → TDD → DDD](docs/WORKFLOW.md)
- v0.1.0 roadmap in progress (see [roadmaps/MAIN.md](roadmaps/MAIN.md))
- Feedback welcome; production use not recommended yet

---

## Project Structure

**Apps:**

- `apps/kernel` — Core orchestration and plugin host
- `apps/studio` — Web IDE for managing data and plugins

**Packages** (reusable libraries):

- `packages/storage-sqlite` — Offline storage with SQLite + OPFS
- `packages/identity-nostr` — Sovereign identity via Nostr
- `packages/sync-crdt` — Real-time sync with CRDT

**Documentation:**

- [Architecture Guide](docs/ARCHITECTURE.md) — System design
- [Workflow Guide](docs/WORKFLOW.md) — Development process (SDD→BDD→TDD→DDD)
- [Research & Validation](docs/research/INDEX.md) — Technical feasibility studies
- [ADRs](docs/specs/ADRs/) — Architecture decisions
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
- **Security issues:** [SECURITY.md](SECURITY.md)
- **License:** [AGPL-3.0](LICENSE)

---

## Further Reading

- [Full Architecture Document](docs/ARCHITECTURE.md)
- [Development Workflow](docs/WORKFLOW.md)
- [Main Roadmap](roadmaps/MAIN.md)
- [Research Validations](docs/research/)
