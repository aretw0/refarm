# Feature: Plugin Lifecycle

**Status**: Draft  
**Version**: v0.1.0  
**Owner**: Core Team

---

## Summary

Plugin Lifecycle manages the complete lifecycle of WASM plugins in Refarm, from loading and initialization to execution and cleanup. It ensures plugins are properly sandboxed, isolated from each other and the kernel, and can be loaded/unloaded dynamically without affecting system stability.

---

## User Stories

### Story 1: Install Plugin

**As a** Refarm user  
**I want** to install a plugin from a URL or file  
**So that** I can extend functionality without code changes

### Story 2: Plugin Isolation

**As a** security-conscious user  
**I want** plugins to be sandboxed and isolated  
**So that** a malicious or buggy plugin can't compromise my data

### Story 3: Hot Reload

**As a** plugin developer  
**I want** to reload my plugin without restarting the app  
**So that** I can iterate quickly during development

### Story 4: Error Recovery

**As a** Refarm user  
**I want** the system to continue working if a plugin crashes  
**So that** one bad plugin doesn't break everything

---

## Acceptance Criteria

### AC1: Plugin Loading

1. **Given** a plugin WASM file URL  
   **When** user clicks "Install Plugin"  
   **Then** plugin is downloaded and validated
   - WASM file fetched via HTTP
   - File size checked (<10MB limit)
   - WIT interface validated
   - Plugin metadata extracted

### AC2: Plugin Initialization

2. **Given** plugin WASM successfully loaded  
   **When** kernel instantiates the plugin  
   **Then** plugin sandbox is created
   - WASM module compiled
   - Host imports bound (kernel-bridge)
   - Plugin exports extracted
   - setup() method called

### AC3: Plugin Execution

3. **Given** plugin is initialized  
   **When** plugin method is invoked (e.g., ingest())  
   **Then** method executes in sandbox
   - Isolated from other plugins
   - Can only access granted capabilities
   - Returns result or throws error
   - Execution time tracked

### AC4: Plugin Error Isolation

4. **Given** plugin throws error during execution  
   **When** error is caught  
   **Then** plugin is isolated, kernel continues
   - Error logged to console
   - Plugin marked as "errored"
   - Other plugins unaffected
   - User sees clear error message

### AC5: Plugin Unloading

5. **Given** an active plugin  
   **When** user clicks "Uninstall"  
   **Then** plugin is cleanly removed
   - teardown() method called
   - WASM module dereferenced
   - Garbage collected
   - Plugin removed from registry

---

## Technical Approach

### Plugin State Machine

```
┌──────────────┐
│ NOT_LOADED   │
└──────┬───────┘
       │ load()
       ▼
┌──────────────┐
│   LOADING    │
└──────┬───────┘
       │ instantiate()
       ▼
┌──────────────┐
│   LOADED     │
└──────┬───────┘
       │ setup()
       ▼
┌──────────────┐
│   RUNNING    │◀──┐
└──────┬───────┘   │ execute methods
       │ error     │
       ▼           │
┌──────────────┐   │
│    ERROR     │───┘ recover()
└──────┬───────┘
       │ unload()
       ▼
┌──────────────┐
│   STOPPED    │
└──────────────┘
```

### Components Involved

- **PluginHost**: Manages plugin registry and lifecycle (apps/kernel)
- **PluginSandbox**: WASM runtime wrapper (apps/kernel)
- **CapabilityManager**: Enforces WIT capabilities (apps/kernel)
- **PluginStorage**: Stores installed plugins (packages/storage-sqlite)

### Key Decisions

- **ADR-008**: [Ecosystem Technology Boundary](../ADRs/ADR-008-ecosystem-technology-boundary.md) - WASM vs Native
- **Validation 3**: [WASI Capability Enforcement](../../docs/research/wasm-validation.md) - Sandbox security

---

## API/Interface

```typescript
/**
 * Plugin state
 */
export type PluginState = 
  | 'not-loaded' 
  | 'loading' 
  | 'loaded' 
  | 'running' 
  | 'error' 
  | 'stopped';

/**
 * Plugin metadata (from WIT)
 */
export interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  author?: string;
  supportedTypes: string[];
  requiredCapabilities: string[];
}

/**
 * Plugin instance
 */
export interface IPlugin {
  id: string;
  state: PluginState;
  metadata: PluginMetadata;
  
  // WIT exports
  setup(): void;
  ingest(): number;
  push(payload: string): void;
  teardown(): void;
  metadata(): PluginMetadata;
}

/**
 * Plugin host manages lifecycle
 */
export interface IPluginHost {
  /**
   * Load plugin from URL
   */
  loadPlugin(url: string): Promise<IPlugin>;
  
  /**
   * Unload plugin
   */
  unloadPlugin(id: string): Promise<void>;
  
  /**
   * Get all loaded plugins
   */
  getPlugins(): IPlugin[];
  
  /**
   * Get plugin by ID
   */
  getPlugin(id: string): IPlugin | null;
  
  /**
   * Execute plugin method safely
   */
  executePlugin<T>(
    id: string, 
    method: string, 
    args?: any[]
  ): Promise<T>;
}

/**
 * Kernel bridge (host imports for plugins)
 */
export interface IKernelBridge {
  log(level: string, message: string): void;
  storeNode(jsonLd: string): string;
  getNode(id: string): string | null;
  queryNodes(filter: string): string;
  hasCapability(capability: string): boolean;
}
```

---

## Test Coverage

### Integration Tests (BDD)

- [ ] Load plugin from URL → state transitions to RUNNING
- [ ] Plugin execution → returns expected result
- [ ] Plugin error → isolated, other plugins continue
- [ ] Unload plugin → cleanup successful
- [ ] Hot reload → plugin updates without restart

### Unit Tests (TDD)

- [ ] `loadPlugin()` validates WASM format
- [ ] `loadPlugin()` enforces size limit
- [ ] `executePlugin()` catches plugin errors
- [ ] `unloadPlugin()` calls teardown()
- [ ] State machine transitions correctly

---

## Implementation Tasks

### SDD (Current Phase)

- [x] Define PluginState enum
- [x] Define IPlugin interface
- [x] Define IPluginHost interface
- [x] Document state machine
- [x] Link relevant ADRs

### BDD (Next Phase)

- [ ] Write integration test: plugin load flow
- [ ] Write integration test: plugin execution
- [ ] Write integration test: error isolation
- [ ] Write integration test: plugin unload

### TDD (Following Phase)

- [ ] Write unit tests for PluginHost
- [ ] Write unit tests for PluginSandbox
- [ ] Write unit tests for error handling

### DDD (Implementation)

- [ ] Implement PluginHost class
- [ ] Implement PluginSandbox wrapper
- [ ] Implement WIT binding via jco
- [ ] Implement kernel-bridge host imports
- [ ] Implement error boundaries
- [ ] Integrate with CapabilityManager

---

## Security Considerations

### Capability Enforcement

```typescript
// Host import: storeNode (requires 'storage' capability)
function storeNode(jsonLd: string): string {
  if (!plugin.hasCapability('storage')) {
    throw new Error('Plugin missing storage capability');
  }
  return kernel.storage.storeNode(JSON.parse(jsonLd));
}
```

### Sandbox Isolation

- WASM cannot access DOM directly
- WASM cannot make network requests (unless capability granted)
- WASM cannot read arbitrary files
- WASM communicates only via WIT interface

---

## Performance Targets

| Operation | Target | Measured |
|-----------|--------|----------|
| Load plugin (<500KB) | <100ms | TBD |
| Setup | <10ms | TBD |
| Execute method | <5ms | TBD |
| Unload plugin | <50ms | TBD |

---

## References

- [ADR-008: Ecosystem Technology Boundary](../ADRs/ADR-008-ecosystem-technology-boundary.md)
- [WIT Contract](../../wit/refarm-sdk.wit)
- [WASM Validation](../../validations/wasm-plugin/)
- [Feature: Session Management](session-management.md)
