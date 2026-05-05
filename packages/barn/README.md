# 🧺 Barn (O Celeiro)

> The Machinery Manager for the Refarm ecosystem — storing, cataloging, and maintaining your sovereign implements.

---

## What Is This?

**Barn** is the dedicated manager for plugin lifecycles within Refarm. Following the **Headless-First** philosophy, it provides the core logic for plugin inventory and integrity, while allowing the UI to be composed by specialized plugins or interactive 3D representations in the Studio. In the "Fertile Soil" (Solo Fértil) metaphor, if the **Tractor** is the engine that orchestrates work, the **Barn** is where your tools (WASM plugins) are kept safe, organized, and ready for use.

It handles the complexities of fetching, verifying, and caching plugin binaries, ensuring that every "implement" attached to your Tractor is authentic and compatible.

### Core Responsibilities:
- 📦 **Inventory Management**: Maintains a unified catalog of plugins (Remote, Local-Dev, Synthetic, or Graph-Synced).
- 🔐 **Integrity & Access Control**: Enforces SHA-256 checks and fine-grained access control to specific graph branches (e.g., preventing access to `main`).
- 💾 **Sovereign Caching & Sync**: Manages persistence in **OPFS** and synchronization of private plugins via the Sovereign Graph (CRDT).
- 🗺️ **Graph-First Orchestration**: Every plugin is a `SovereignNode`, allowing the system to build itself through plugin composition.

---

## Quick Start

### 1. Installation

As part of the Refarm monorepo, the Barn is managed via NPM workspaces:

```bash
cd refarm
npm install
```

### 2. Run Tests

The Barn owns its integration and unit tests to ensure machinery reliability:

```bash
cd packages/barn
npm test
```

---

## Project Structure

```
packages/barn/
├── src/
│   └── index.ts          # Main Barn class & logic
├── wit/
│   └── refarm-barn.wit   # WIT interface definitions
├── docs/
│   └── SCHEMA.md         # JSON-LD Sovereign Graph schema
├── tests/
│   └── integration.test.ts # BDD/Integration suite
├── package.json
└── tsconfig.json
```

---

## Technical Overview

### Plugin Installation Flow

The Barn follows a strict security protocol when "storing" a new implement, delegating installation to the shared `installWasmArtifact` contract:

1. **Check cache**: Resolve cache by `pluginId`.
2. **Verify**: Validate cached/fetched binary against provided SHA-256 digest.
3. **Evict on mismatch**: Remove stale cache before refetch.
4. **Fetch + Store**: Persist through the configured cache adapter (Barn currently uses in-memory adapter; Tractor uses OPFS canonical layout).
5. **Register**: Add/update plugin in local inventory.

### WIT Interface

Plugins and the Host interact with the Barn via the `refarm:barn/manager` interface:

```wit
interface manager {
    install-plugin: func(url: string, integrity: string) -> result<plugin-entry, plugin-error>;
    list-plugins: func() -> result<list<plugin-entry>, plugin-error>;
    uninstall-plugin: func(id: node-id) -> result<_, plugin-error>;
}
```

---

## Roadmap

The Barn is currently in **Phase 1 (SDD/BDD)**. See the detailed [ROADMAP.md](./ROADMAP.md) for upcoming milestones and technical goals.

For the latest install/cache/integrity flow mapping used by runtime hardening, see
[`docs/INSTALL_FLOW_AUDIT_20260423.md`](./docs/INSTALL_FLOW_AUDIT_20260423.md).

---

## License

[AGPL-3.0-only](../../LICENSE)
