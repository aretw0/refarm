# 🧺 Barn (O Celeiro)

> The Machinery Manager for the Refarm ecosystem — storing, cataloging, and maintaining your sovereign implements.

---

## What Is This?

**Barn** is the dedicated manager for plugin lifecycles within Refarm. In the "Fertile Soil" (Solo Fértil) metaphor, if the **Tractor** is the engine that orchestrates work, the **Barn** is where your tools (WASM plugins) are kept safe, organized, and ready for use.

It handles the complexities of fetching, verifying, and caching plugin binaries, ensuring that every "implement" attached to your Tractor is authentic and compatible.

### Core Responsibilities:
- 📦 **Inventory Management**: Maintains a catalog of all installed and available plugins.
- 🔐 **Integrity Verification**: Enforces SHA-256 checks on all WASM binaries before they enter the soil.
- 💾 **Sovereign Caching**: Manages local persistence of plugins using **OPFS** (Origin Private File System), ensuring offline availability.
- 🗺️ **Graph Integration**: Represents plugins as `SovereignNodes` in the graph, making them discoverable by the **Surveyor** (Agrimensor).

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

The Barn follows a strict security and persistence protocol when "storing" a new implement:

1. **Fetch**: Retrieve the WASM binary and its manifest from a URL.
2. **Verify**: Validate the binary against the provided SHA-256 hash.
3. **Store**: Persist the binary into the **OPFS** cache for sovereign, offline access.
4. **Register**: Add the plugin to the local inventory and emit a `SovereignNode` to the graph.

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

---

## License

[AGPL-3.0-only](../../LICENSE)
