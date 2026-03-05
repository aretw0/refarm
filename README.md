# 🌱 Refarm

> **Personal Operating System for Sovereign Data**

Refarm centralises and "reforms" data from multiple fragmented sources into a single, portable, offline-first graph that belongs entirely to you.

---

## Key Features

- **Offline-First** — All data lives in your browser via SQLite/OPFS. No cloud required.
- **Plugin Architecture** — Integrations run as WASM components in a sandboxed kernel. Client-side only; no server bots.
- **Decentralised Marketplace** — Plugins are discovered and distributed via [Nostr](https://nostr.com) (NIP-89/94). No central registry.
- **Sovereign Data Graph** — All data is normalised to JSON-LD before persistence, making it semantically portable across any platform.
- **Radical Ejection Right** — Every primitive (`storage-sqlite`, `identity-nostr`, `sync-crdt`) works independently of Refarm.

---

## Monorepo Structure

```
refarm/
├── apps/
│   ├── kernel/          # 🌱 Core Kernel — SQLite, plugin host, graph normaliser
│   └── studio/          # 🎨 In-browser IDE (Astro) — develop and manage plugins
├── packages/
│   ├── storage-sqlite/  # SQLite/OPFS storage primitive (independent library)
│   ├── identity-nostr/  # Nostr keypair + NIP-89/94 plugin discovery
│   └── sync-crdt/       # CRDT sync: vector clocks, LWW register, OR-Set
├── wit/
│   └── refarm-sdk.wit   # WIT interface for plugin ↔ kernel communication
├── schemas/
│   └── sovereign-graph.jsonld  # JSON-LD schema with worked examples
├── examples/
│   └── whatsapp-bridge/ # Example plugin implementing the WIT interface
└── docs/
    └── architecture.md  # Full architecture documentation
```

---

## Quick Start

```bash
npm install
npm run dev      # Start all apps in watch mode
npm run build    # Build everything
npm test         # Run all tests
```

See [`docs/architecture.md`](docs/ARCHITECURE.md) for the full architecture overview, data flow diagrams, and plugin development guide.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to Refarm, including our workflow with Changesets.

---

## Security

For information about known vulnerabilities in dependencies and how to report security issues, see [`SECURITY.md`](SECURITY.md).

---

## Licença

[AGPL-3.0](LICENSE)
