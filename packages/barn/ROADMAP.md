# Barn (O Celeiro) - Roadmap Consolidado

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## Overview

The **Barn (O Celeiro)** is the machinery manager for the Refarm ecosystem. It is responsible for:

- Plugin lifecycle management (Install/Uninstall)
- OPFS Cache management for WASM binaries
- Integrity verification (SHA-256)
- Inventory of available and installed plugins
- Integration with the Sovereign Graph (SovereignNodes)

---

## Technical Decisions

### Storage Pattern: OPFS (Origin Private File System)

To ensure sovereignty and offline-first availability, all plugin binaries are stored in the browser's **OPFS**. This bypasses standard `localStorage` limits and provides high-performance access to WASM components. See [STORAGE_LAYOUT.md](./docs/STORAGE_LAYOUT.md) for details.

### Security Model: Integrity Verification

The Barn enforces a strict integrity check on every "implement" (plugin) before it is stored or loaded.

1. **Fetch**: Retrieve WASM binary.
2. **Hash**: Compute SHA-256 of the binary.
3. **Verify**: Compare against the `integrity` field provided in the installation call.
4. **Reject**: If hashes don't match, the binary is immediately discarded.

---

## v0.1.0 - Plugin Lifecycle & Persistence (CURRENT)

**Scope**: Bootstrap Barn with plugin installation, SHA-256 verification, and OPFS caching.

### SDD (Spec Driven) ✅

- [x] Spec: Barn WIT interface definitions (`refarm-barn.wit`)
- [x] Spec: JSON-LD Schema for `PluginCatalogEntry` (`docs/SCHEMA.md`)
- [x] Spec: OPFS storage layout and naming convention (`docs/STORAGE_LAYOUT.md`)
- [x] Spec: Headless-First plugin design principles (`README.md`)
- [x] Spec: Graph-based Access Control & Branching (`docs/SCHEMA.md`)

### BDD (Behaviour Driven) 🚧

- [x] Integration: Install a new plugin with valid metadata (PASSING - Mock)
- [x] Integration: List installed plugins in the inventory (PASSING - Mock)
- [ ] Integration: Verify SHA-256 integrity during installation (BDD phase)
- [ ] Integration: Persist and retrieve plugin binary from OPFS
- [ ] Integration: Uninstall a plugin and cleanup OPFS
- [ ] Integration: Enforce branch-level access control (e.g., block write to `main`)

### TDD (Test Driven) 🔄

- [ ] Unit: SHA-256 hash calculation and comparison
- [ ] Unit: OPFS file handle management
- [ ] Unit: Inventory state management (in-memory + persistence)
- [ ] Coverage: >80%

### DDD (Domain Implementation) 🔄

- [x] Domain: Initial `Barn` class structure
- [ ] Domain: `BarnCache` implementation (OPFS)
- [ ] Domain: `BarnManager` implementation (WIT bridge)
- [ ] Infra: Integration with `@refarm.dev/tractor` for plugin loading

---

## v0.2.0 - Graph Discovery & Dynamic Loading

**Scope**: Connect the Barn to the Sovereign Graph and enable dynamic plugin discovery.

- [ ] Integration: Emit `SovereignNode` to the graph on plugin installation
- [ ] Integration: Fetch plugins from remote URLs defined in the graph
- [ ] Integration: Support for plugin "stables" (remote repositories)
- [ ] Integration: Dynamic capability injection into plugins

---

## CHANGELOG

```
## [0.1.0-dev] - 2026-03-22
### Added
- Consolidated SCHEMA.md for Sovereign Graph integration.
- Refined README.md with Headless-First philosophy.
- Initial specifications for Surveyor and Creek integration.
- Storage layout specification for OPFS.
### Fixed
- Stabilized monorepo structure and dependency resolution paths.

## [0.0.1-dev] - 2026-03-21
### Added
- Initial project scaffolding and monorepo integration.
- WIT interface definitions for Barn manager.
- JSON-LD schema for PluginCatalogEntry.
- Integration test suite (BDD) with mock implementation.
```
