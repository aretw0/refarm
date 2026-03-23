# Homestead (Browser SDK) - Roadmap

**Current Version**: v0.1.0-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## v0.1.0 - Bootstrap Shell (DONE/In Progress)
**Scope**: Establish the core `StudioShell` and primary plugins (Herald, Firefly).  
**Depends on**: `sync-loro` (Client sync), `tractor-ts` (Internal host)

### SDD (Spec Driven) ✅
- [x] Spec: `StudioShell` core architecture (Slot-based layout).
- [x] Spec: `HeraldPlugin` (Identity & Presence) contract.
- [x] Spec: `FireflyPlugin` (System Notifications) contract.
- [x] Spec: Headless UI primitive contracts (A11y, Tokens).

### BDD (Behaviour Driven) ✅
- [x] Integration: `StudioShell` mounts in DOM with active slots.
- [x] Integration: `HeraldPlugin` correctly identifies user status.
- [x] Integration: Notifications displayed via `FireflyPlugin`.
- [x] Acceptance: PWA manifest + Service Worker confirmed.

### TDD (Test Driven) ✅
- [x] Unit: `Shell` plugin registration and lifecycle tests.
- [x] Unit: Semantic token resolution (Dark/Light modes).
- [x] Coverage: >80%

### DDD (Domain Implementation) ✅
- [x] Domain: Core `Homestead` SDK.
- [x] Infra: Browser-only implementation of the Refarm shell.

---

## v0.2.0 - Sovereign Graph UI
**Scope**: Rendering the user's digital estate directly from the Sovereign Graph.

- [ ] Implementation of **UI-as-a-Node**: The shell layout and available plugins are discovered as JSON-LD nodes in the graph.
- [ ] **Dynamic Intent Routing**: Navigating the UI based on sovereign intents rather than static URLs.
- [ ] Integration with `surveyor` for graph-native navigation components.

---

## v0.3.0 - Plugin UI Registration
**Scope**: Enabling 3rd-party WASM plugins to register complex UI components at runtime.

- [ ] Implementation of **Cross-WASM UI Bridge**: Standardizing how a WASM plugin provides React/Vue/Svelte-compatible UI definitions to the host.
- [ ] **Sandboxed UI**: Visual isolation and capability gating for plugin-provided components.

---

## Notes
- See [packages/homestead/src/sdk/Shell.ts](./src/sdk/Shell.ts) for core logic.
- The "Face" of the sovereign citizen — the portal to their digital farm.
