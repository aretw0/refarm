# Registry (Plugin Discovery) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Foundation (DONE/In Progress)
**Scope**: Establish the core plugin discovery, validation, and activation engine.  
**Depends on**: `tractor` (Plugin loading), `heartwood` (Signatures)

### SDD (Spec Driven) ✅
- [x] Spec: `SovereignRegistry` core interface.
- [x] Spec: Plugin manifest resolution (HTTP/JSON).
- [x] Spec: Hardened validation via Ed25519 (Heartwood).

### BDD (Behaviour Driven) ✅
- [x] Integration: Register a plugin via manifest.
- [x] Integration: Cryptographically validate plugin using Heartwood.
- [x] Integration: Activate/Deactivate plugins.

### TDD (Test Driven) ✅
- [x] Unit: Registry state export/import tests.
- [x] Unit: Plugin status transition (registered → validated → active).
- [x] Coverage: >85%

### DDD (Domain Implementation) ✅
- [x] Domain: Core `SovereignRegistry` logic.
- [x] Infra: Heartwood signature verification bridge.

---

## v0.2.0 - Sovereign Graph Integration
**Scope**: Connect the Registry to the user's graph as the primary discovery layer.

- [ ] Implementation of **Graph Nodes for Registry**: Emit a `refarm:PluginRegistry` node to the graph on plugin installation.
- [ ] **Dynamic Discovery**: Resolving plugins directly from IPs or URLs specified in the graph rather than hardcoding in the distro.
- [ ] **Curated Feeds**: Following other users' registries via Nostr/IPFS.

---

## v0.3.0 - Dynamic Capabilities
**Scope**: Rewiring plugin capabilities at runtime based on the registry state.

- [ ] Implementation of **Capability Injection**: Informing `tractor` of which host factors (factors) a validated plugin is authorized to access.
- [ ] Dynamic permission prompts for "extra-WASI" capabilities.

---

## Notes
- See [packages/registry/README.md](./README.md) for initial feature list.
- Central gateway between the discovery (Graph) and execution (Tractor) layers.
