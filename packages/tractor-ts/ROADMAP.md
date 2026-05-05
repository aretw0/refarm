# Kernel - Roadmap

**Current Version**: v0.0.1-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## pi-era recalibration

`@refarm.dev/tractor-ts` is on the daily-driver critical path as the browser/client helper layer for Tractor observations, runtime descriptors, stream reducers, and future UI subscriptions. Version headings below are legacy capability buckets, not promises to publish `v0.2.0+` after `v0.1.0`; prioritize helpers that let `apps/me` replace the current external pi workflow.

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

## Technical Decisions

### Architecture Pattern: Service Registry + Event Bus

**Service Registry** (Dependency Injection):

```typescript
export class ServiceRegistry {
  private services = new Map<string, any>();
  private lifecycle = new Map<string, 'init' | 'started' | 'stopped'>();

  register<T>(name: string, service: T): void {
    this.services.set(name, service);
    this.lifecycle.set(name, 'init');
  }

  get<T>(name: string): T {
    if (!this.services.has(name)) {
      throw new Error(`Service not found: ${name}`);
    }
    return this.services.get(name) as T;
  }

  async start(name: string): Promise<void> {
    const service = this.get(name);
    if (typeof service.start === 'function') {
      await service.start();
    }
    this.lifecycle.set(name, 'started');
  }
}
```

**Event Bus** (Pub/Sub):

```typescript
export class EventBus {
  private listeners = new Map<string, Set<Function>>();

  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  emit(event: string, data?: any): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const callback of callbacks) {
        // Error isolation: one listener crash doesn't break others
        try {
          callback(data);
        } catch (err) {
          console.error(`Event handler error (${event}):`, err);
        }
      }
    }
  }
}
```

### Bootstrap Sequence

**Initialization order** (v0.1.0):

```typescript
export class Kernel {
  private registry = new ServiceRegistry();
  private eventBus = new EventBus();

  async boot(): Promise<void> {
    // 1. Load config (localStorage + defaults)
    const config = await this.loadConfig();
    
    // 2. Initialize storage (OPFS + SQLite)
    const storage = new StorageService(config.vaultId);
    await storage.init();
    this.registry.register('storage', storage);
    
    // 3. Initialize sync (CRDT + IndexedDB)
    const sync = new SyncService(config.vaultId);
    await sync.init(storage);
    this.registry.register('sync', sync);
    
    // 4. Wire event bus
    sync.on('update', (update) => {
      this.eventBus.emit('sync:update', update);
    });
    
    storage.on('change', (change) => {
      this.eventBus.emit('storage:change', change);
    });
    
    // 5. Emit ready
    this.eventBus.emit('kernel:ready');
  }
}
```

### Guest vs Permanent User Session

**Session detection**:

```typescript
interface VaultMetadata {
  vaultId: string;
  type: 'guest' | 'permanent';
  storageTier: 'ephemeral' | 'persistent' | 'synced';
  pubkey?: string; // Only for permanent
  createdAt: number;
}

async loadConfig(): Promise<VaultMetadata> {
  const stored = localStorage.getItem('refarm:vault');
  
  if (stored) {
    return JSON.parse(stored);
  }
  
  // First boot: Create guest vault
  const metadata: VaultMetadata = {
    vaultId: crypto.randomUUID(),
    type: 'guest',
    storageTier: 'persistent', // Default (user can change)
    createdAt: Date.now(),
  };
  
  localStorage.setItem('refarm:vault', JSON.stringify(metadata));
  return metadata;
}
```

**Guest → Permanent upgrade**:

```typescript
async upgradeToPermanent(mnemonic: string): Promise<void> {
  const identity = await IdentityService.fromMnemonic(mnemonic);
  
  // 1. Rewrite ownership in SQLite
  const storage = this.registry.get<StorageService>('storage');
  await storage.exec(`
    UPDATE nodes 
    SET vault_id = ? 
    WHERE vault_id = ?
  `, [identity.pubkey, this.config.vaultId]);
  
  // 2. Update metadata
  this.config.vaultId = identity.pubkey;
  this.config.type = 'permanent';
  this.config.pubkey = identity.pubkey;
  localStorage.setItem('refarm:vault', JSON.stringify(this.config));
  
  // 3. Register identity service
  this.registry.register('identity', identity);
  
  // 4. Restart kernel (reload storage with new vaultId)
  await this.restart();
}
```

### Error Handling Strategy

**Error boundaries** (isolate component failures):

```typescript
async safeStart(serviceName: string): Promise<void> {
  try {
    await this.registry.start(serviceName);
    console.log(`✓ ${serviceName} started`);
  } catch (err) {
    console.error(`✗ ${serviceName} failed:`, err);
    this.eventBus.emit('kernel:error', {
      service: serviceName,
      error: err,
    });
    
    // Attempt recovery (retry 3 times)
    await this.retryStart(serviceName, 3);
  }
}
```

**Self-healing** (restart failed services):

```typescript
async retryStart(serviceName: string, retries: number): Promise<void> {
  for (let i = 0; i < retries; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    try {
      await this.registry.start(serviceName);
      console.log(`✓ ${serviceName} recovered after ${i + 1} retries`);
      return;
    } catch (err) {
      console.warn(`Retry ${i + 1}/${retries} failed`);
    }
  }
  
  // Give up, disable service
  this.registry.disable(serviceName);
  this.eventBus.emit('kernel:service-disabled', serviceName);
}
```

### Configuration Management

**Layered config** (defaults → localStorage → runtime):

```typescript
const defaultConfig = {
  storageTier: 'persistent',
  syncEnabled: true,
  logLevel: 'info',
  pluginsEnabled: true,
};

const userConfig = JSON.parse(localStorage.getItem('refarm:config') || '{}');

const config = {
  ...defaultConfig,
  ...userConfig,
  ...runtimeOverrides, // From URL params or dev tools
};
```

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
