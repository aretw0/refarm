# Kernel - Roadmap

**Current Version**: v0.0.1-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## Overview

The **Kernel** is the core orchestration layer of Refarm responsible for:

- Component lifecycle management (storage, sync, identity, AI, plugins)
- Dependency injection and service registration
- Event bus and inter-component communication
- Error boundaries and self-healing coordination
- Configuration management
- Bootstrap and initialization

---

## v0.1.0 - Core Orchestration (Storage + Sync)
**Scope**: Bootstrap kernel with storage and sync orchestration  
**Depends on**: `storage-sqlite`, `sync-crdt`

### SDD (Spec Driven)

**Goal**: Define kernel architecture and component contracts  
**Gate**: Specs complete, peer reviewed, no TODOs

- [ ] ADR-001: Contribute to Monorepo structure decision
- [ ] ADR-002: Contribute to Offline-first strategy
- [ ] Spec: Kernel initialization lifecycle
  - [ ] Bootstrap sequence (config → storage → sync → ready)
  - [ ] Graceful shutdown sequence
  - [ ] Error states and recovery
- [ ] Spec: Service registry pattern
  - [ ] Component registration API
  - [ ] Dependency resolution
  - [ ] Lifecycle hooks (onInit, onStart, onStop)
- [ ] Spec: Event bus interface
  - [ ] Publish/subscribe pattern
  - [ ] Event namespacing
  - [ ] Error handling in listeners

### BDD (Behaviour Driven)

**Goal**: Write integration tests that describe expected behavior (FAILING)  
**Gate**: Tests written (🔴 RED), peer reviewed

- [ ] Integration: Kernel initializes successfully
- [ ] Integration: Storage component registers and becomes available
- [ ] Integration: Sync component starts after storage ready
- [ ] Integration: Event published, listeners receive it
- [ ] Integration: Component fails, kernel isolates error
- [ ] Acceptance: App boots, stores data, syncs between instances

### TDD (Test Driven)

**Goal**: Write unit tests for contracts (FAILING)  
**Gate**: Tests written (🔴 RED), coverage ≥80%

- [ ] Unit: Service registry registration/retrieval
- [ ] Unit: Dependency graph resolution
- [ ] Unit: Event bus publish/subscribe
- [ ] Unit: Initialization sequence ordering
- [ ] Unit: Shutdown cleanup
- [ ] Coverage: >80%

### DDD (Domain Implementation)

**Goal**: Implement code until all tests PASS  
**Gate**: Tests GREEN (🟢), coverage met, changeset created

- [ ] Domain: Service registry implementation
- [ ] Domain: Event bus implementation
- [ ] Domain: Lifecycle manager
- [ ] Domain: Error boundary wrapper
- [ ] Infra: Configuration loader (JSON/env)
- [ ] Infra: Logger integration

### CHANGELOG

```
## [0.1.0] - YYYY-MM-DD
### Added
- Core kernel orchestration
- Service registry for component management
- Event bus for inter-component communication
- Lifecycle management (init/shutdown)
- Storage and Sync integration
```

---

## v0.2.0 - Identity + Network Orchestration
**Scope**: Integrate identity and network components  
**Depends on**: `identity-nostr`, `network`

### SDD (Spec Driven)

- [ ] Spec: Identity service registration
  - [ ] Keypair management lifecycle
  - [ ] Event signing coordination
  - [ ] Profile state management
- [ ] Spec: Network service registration
  - [ ] Relay connection lifecycle
  - [ ] P2P discovery coordination
  - [ ] Message routing between components

### BDD (Behaviour Driven)

- [ ] Integration: Identity service initializes with keypair
- [ ] Integration: Network service connects to relays
- [ ] Integration: Kernel coordinates storage → identity → network chain
- [ ] Acceptance: User identity persists, devices discover each other

### TDD (Test Driven)

- [ ] Unit: Identity service registration
- [ ] Unit: Network service registration
- [ ] Unit: Component dependency chain (storage → identity → network)
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: Identity orchestration
- [ ] Domain: Network orchestration
- [ ] Domain: Component dependency injection
- [ ] Infra: Identity service adapter
- [ ] Infra: Network service adapter

### CHANGELOG

```
## [0.2.0] - YYYY-MM-DD
### Added
- Identity service orchestration (Nostr)
- Network service orchestration (P2P + Relays)
- Dependency injection between components
```

---

## v0.3.0 - AI Orchestration
**Scope**: Integrate AI inference and embeddings  
**Depends on**: `ai-inference`, `embeddings`

### SDD (Spec Driven)

- [ ] Spec: AI service registration
  - [ ] Model loading lifecycle
  - [ ] Inference request queuing
  - [ ] Worker coordination
- [ ] Spec: Embedding service registration
  - [ ] Batch processing
  - [ ] Cache management

### BDD (Behaviour Driven)

- [ ] Integration: AI service loads model in Worker
- [ ] Integration: Component requests inference, receives response
- [ ] Integration: Embedding service generates vectors for storage
- [ ] Acceptance: Kernel coordinates AI without blocking main thread

### TDD (Test Driven)

- [ ] Unit: AI service registration
- [ ] Unit: Worker message protocol
- [ ] Unit: Request queue management
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: AI orchestration
- [ ] Domain: Worker pool management
- [ ] Infra: WebLLM service adapter
- [ ] Infra: Transformers.js adapter

### CHANGELOG

```
## [0.3.0] - YYYY-MM-DD
### Added
- AI inference orchestration (WebLLM)
- Embedding generation (Transformers.js)
- Worker pool management for AI tasks
```

---

## v0.4.0 - Plugin System
**Scope**: WASM plugin lifecycle and capability management  
**Depends on**: `plugin-runtime`, `capability-system`

### SDD (Spec Driven)

- [ ] Spec: Plugin lifecycle orchestration
  - [ ] Load/unload plugins
  - [ ] Sandbox creation per plugin
  - [ ] Capability grant/deny logic
- [ ] Spec: Plugin → Kernel API bridge
  - [ ] Storage access (capability-gated)
  - [ ] Network access (capability-gated)
  - [ ] AI access (capability-gated)

### BDD (Behaviour Driven)

- [ ] Integration: Kernel loads plugin WASM
- [ ] Integration: Plugin requests storage, kernel grants capability
- [ ] Integration: Plugin executes in isolation
- [ ] Integration: Plugin crashes, kernel recovers gracefully
- [ ] Acceptance: Plugins extend kernel safely

### TDD (Test Driven)

- [ ] Unit: Plugin registration
- [ ] Unit: Capability checking logic
- [ ] Unit: Sandbox isolation
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: Plugin orchestration
- [ ] Domain: Capability system integration
- [ ] Infra: WASM runtime adapter
- [ ] Infra: Plugin-to-kernel bridge

### CHANGELOG

```
## [0.4.0] - YYYY-MM-DD
### Added
- Plugin ecosystem orchestration
- Capability-based security system
- WASM runtime integration
```

---

## v0.5.0 - Studio Integration
**Scope**: IPC bridge for Studio UI  
**Depends on**: `studio` app

### SDD (Spec Driven)

- [ ] Spec: Kernel ↔ Studio IPC protocol
  - [ ] postMessage API
  - [ ] State synchronization
  - [ ] Command/query pattern

### BDD (Behaviour Driven)

- [ ] Integration: Studio sends command, kernel executes
- [ ] Integration: Kernel state changes, Studio receives update
- [ ] Integration: Studio requests data, kernel responds
- [ ] Acceptance: Studio fully controls kernel via IPC

### TDD (Test Driven)

- [ ] Unit: IPC message validation
- [ ] Unit: Command handler routing
- [ ] Unit: State serialization for Studio
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: IPC bridge
- [ ] Domain: State projection for UI
- [ ] Infra: postMessage protocol

### CHANGELOG

```
## [0.5.0] - YYYY-MM-DD
### Added
- Studio IPC bridge
- Real-time state synchronization
- Command/query API for UI
```

---

## v0.6.0 - Observability & Self-Healing
**Scope**: Error boundaries, dump generation, recovery  
**Depends on**: `observability`, `error-recovery`

### SDD (Spec Driven)

- [ ] Spec: Error boundary integration
  - [ ] Component-level error isolation
  - [ ] Automatic recovery strategies
  - [ ] Dump generation on fatal errors
- [ ] Spec: Telemetry coordination
  - [ ] Event emission from kernel
  - [ ] Observer plugin lifecycle

### BDD (Behaviour Driven)

- [ ] Integration: Component fails, kernel isolates error
- [ ] Integration: Kernel restarts failed component
- [ ] Integration: Dump generated and saved
- [ ] Integration: Observer plugins receive telemetry
- [ ] Acceptance: Kernel never fully crashes

### TDD (Test Driven)

- [ ] Unit: Error boundary wrapping
- [ ] Unit: Recovery strategy selection
- [ ] Unit: Dump generation
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: Error boundaries for all components
- [ ] Domain: Self-healing orchestration
- [ ] Infra: Dump persistence (OPFS)

### CHANGELOG

```
## [0.6.0] - YYYY-MM-DD
### Added
- Error boundaries for all components
- Self-healing with automatic recovery
- Dump generation for debugging
- Observability primitives
```

---

## v1.0.0 - Production Polish
**Scope**: Performance optimization, bundle size, error messages  
**Depends on**: All components stable

### Quality Criteria

- [ ] Bundle size <100KB (gzipped)
- [ ] Cold start <500ms
- [ ] Memory usage <50MB (idle)
- [ ] All TODOs resolved
- [ ] Error messages user-friendly
- [ ] Test coverage >85%

### CHANGELOG

```
## [1.0.0] - YYYY-MM-DD
### Changed
- Performance optimizations (lazy loading, tree shaking)
- Bundle size reduced to <100KB
- Improved error messages

### Fixed
- [All known bugs addressed]
```

---

## Notes

- **Dependencies**: Kernel depends on ALL other packages
- **Critical Path**: Kernel blocking = entire system blocking
- **Performance**: Optimize kernel initialization (lazy loading)
- **Testing**: Integration tests critical for multi-component scenarios
