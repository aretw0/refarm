# ADR-021: Self-Healing & Plugin Citizenship

**Status**: Proposed  
**Date**: 2026-03-07  
**Deciders**: Core Team  
**Related**: ADR-017 (Micro-kernel), ADR-002 (Offline-first), ADR-020 (Graph Versioning)

---

## Context

Refarm grants users **full data sovereignty**: offline-first, multi-device, no central authority. This means **the system must heal itself** or the user loses trust.

Threats to sovereignty:

1. **Plugin misbehavior**: A third-party plugin leaks data, consumes memory, or corrupts CRDT state
2. **Storage degradation**: IndexedDB quota exceeded, OPFS file corruption, stale schema versions
3. **Sync cascades**: One device with bad data infects others via CRDT merge
4. **Silent data loss**: Graph silently inconsistent, user doesn't see it until too late

**Current state**: No monitoring, no recovery, no policies. A single bad plugin kills the entire system.

---

## Decision

**Implement self-healing system with two layers:**

1. **Low-level (Storage & CRDT healing)**: Automatic recovery from corruption
2. **High-level (Plugin Citizenship)**: Monitoring, isolation, and policy enforcement

Both are **kernel responsibilities** (not plugins), integrated with observability (ADR-007).

---

## Layer 1: Storage & CRDT Self-Healing

### Problem: What can go wrong?

```
OPFS corruption → SQLite file corrupted → schema incompatibility
IndexedDB quota exceeded → CRDT updates lost → divergence
Stale CRDT snapshot → old schema applied → upcasting fails
Plugin writes garbage → graph nodes malformed → queries fail
```

### Solution: Checksums + Snapshots + Rollback

#### 1a. Checksum on Write

```typescript
// packages/storage-sqlite/src/self-healing/checksums.ts

interface StoredNode {
  id: string;
  data: object;
  schemaVersion: string;
  checksum: string;      // BLAKE3(id + data + schemaVersion)
  timestamp: number;
}

class ChecksumManager {
  /**
   * Before storing: compute checksum
   * After reading: verify checksum
   */
  beforeStore(node: any): StoredNode {
    return {
      ...node,
      checksum: this.compute(node)
    };
  }

  afterFetch(stored: StoredNode): any {
    const computed = this.compute(stored);
    
    if (computed !== stored.checksum) {
      // Corruption detected
      throw new CorruptionError(`Node ${stored.id} failed checksum`);
    }
    
    return stored;
  }

  private compute(node: any): string {
    const canonical = JSON.stringify({
      id: node.id,
      data: node.data,
      schema: node.schemaVersion
    });
    return blake3(canonical);
  }
}
```

#### 1b. Snapshot Isolation (Write-Ahead Logging)

```typescript
// Index every commit (from ADR-020) to IndexedDB write-ahead log

class WriteAheadLog {
  /**
   * Before applying CRDT update: log it
   * On corruption: replay from last good snapshot
   */
  async logUpdate(update: Uint8Array, authorDID: string) {
    const entry = {
      timestamp: Date.now(),
      batchId: generateId(),
      update,
      authorDID,
      crdtChecksum: this.checksum(update)
    };

    // Persist before applying
    await this.db.put('wal', entry);
    
    return entry.batchId;
  }

  /**
   * On boot, verify last snapshot matches
   * If mismatch: replay from checkpoint
   */
  async repairIfNeeded(lastSnapshot: Uint8Array): Promise<Uint8Array> {
    const lastWalEntry = await this.db.get('wal', { reverse: true, limit: 1 });
    
    if (!lastWalEntry) {
      // No WAL, assume snapshot is good
      return lastSnapshot;
    }

    const expectedState = await this.replayFrom(lastWalEntry.batchId);
    const expectedChecksum = this.checksum(expectedState);
    const actualChecksum = this.checksum(lastSnapshot);

    if (expectedChecksum !== actualChecksum) {
      console.warn(`⚠️ CRDT checkpoint mismatch, replaying WAL`);
      return expectedState;  // Use replayed state
    }

    return lastSnapshot;
  }

  private async replayFrom(batchId: string): Promise<Uint8Array> {
    const entries = await this.db.getAll('wal', { after: batchId });
    let state = new Y.Doc();

    for (const entry of entries) {
      Y.applyUpdate(state, entry.update);
    }

    return Y.encodeStateAsUpdate(state);
  }
}
```

#### 1c. Schema Validation on Read

```typescript
// Integrate ADR-010 with self-healing

class SelfHealingSchemaManager {
  /**
   * On read: attempt upcast, if fails → recovery
   */
  async fetchNode(nodeId: string): Promise<any> {
    const stored = await this.db.get('nodes', nodeId);

    try {
      // Try normal upcast (ADR-010)
      return this.schemaManager.upcast(stored);
    } catch (e) {
      // Upcast failed: attempt recovery
      console.error(`⚠️ Schema upcast failed for ${nodeId}, attempting recovery`);
      
      return this.attemptRecovery(stored, e);
    }
  }

  private async attemptRecovery(stored: any, error: Error): Promise<any> {
    // Strategy 1: Fall back to older schema version
    const versions = ['v0', 'v1', 'v2'];
    
    for (const version of versions) {
      try {
        const recovered = await this.downgrade(stored, version);
        console.warn(`✅ Recovered ${stored.id} by downgrading to ${version}`);
        return recovered;
      } catch (e) {
        // Try next version
      }
    }

    // Strategy 2: Extract minimal fields we can salvage
    const salvaged = {
      '@id': stored['@id'],
      '@type': stored['@type'],
      _recovery: {
        error: error.message,
        timestamp: Date.now(),
        salvagedFields: Object.keys(stored)
      }
    };

    console.error(`❌ Could not recover ${stored.id}, salvaging structure only`);
    
    return salvaged;
  }
}
```

---

## Layer 2: Plugin Citizenship Monitoring

### Concept: Plugins as First-Class Citizens with Health Status

Each plugin is assigned:
- **Resource quota**: Memory, CPU, I/O limits
- **Behavior trace**: Operations logged for forensics
- **Health score**: Calculated from health signals
- **Circuit breaker**: Automatic isolation if score degrades

```typescript
// apps/kernel/src/plugin-loader/plugin-citizenship.ts

interface PluginCitizen {
  pluginId: string;
  manifest: PluginManifest;
  
  // Quotas
  memoryQuota: number;        // MB
  cpuTimeQuota: number;       // ms/sec
  ioQuota: number;            // ops/sec
  
  // Health
  healthScore: number;        // 0-100
  healthSignals: {
    memoryUsage: number;
    cpuTimeUsage: number;
    errorRate: number;        // 0-1 (% of operations failed)
    responseTime: number;      // ms
    lastHealthCheckAt: number;
  };

  // Policy
  state: 'healthy' | 'degraded' | 'isolated' | 'quarantined';
  transitions: Array<{
    from: string;
    to: string;
    reason: string;
    timestamp: number;
  }>;
}

class PluginCitizenshipMonitor {
  private citizens: Map<string, PluginCitizen> = new Map();
  private observability: ObservabilityPipeline;

  /**
   * Register plugin with citizenship
   */
  async onPluginLoad(pluginId: string, manifest: PluginManifest) {
    const citizen: PluginCitizen = {
      pluginId,
      manifest,
      memoryQuota: manifest.resources?.memory ?? 64,  // Default 64MB
      cpuTimeQuota: manifest.resources?.cpuTime ?? 500,  // Default 500ms/s
      ioQuota: manifest.resources?.io ?? 1000,
      healthScore: 100,
      healthSignals: { /* zeros */ },
      state: 'healthy',
      transitions: []
    };

    this.citizens.set(pluginId, citizen);
    
    // Start monitoring
    this.startHealthChecks(citizen);
  }

  /**
   * Report plugin behavior (called by kernel after each plugin op)
   */
  async reportOperation(
    pluginId: string,
    operation: {
      name: string;
      duration: number;
      memoryDelta: number;
      success: boolean;
      error?: Error;
    }
  ) {
    const citizen = this.citizens.get(pluginId);
    if (!citizen) return;

    // Update signals
    citizen.healthSignals.memoryUsage += operation.memoryDelta;
    citizen.healthSignals.cpuTimeUsage += operation.duration;
    if (!operation.success) {
      citizen.healthSignals.errorRate = 
        (citizen.healthSignals.errorRate * 0.9) + 0.1;  // EMA
    }

    // Emit event
    this.observability.record({
      event: 'plugin_operation',
      pluginId,
      ...operation
    });

    // Check health
    await this.updateHealthScore(citizen);
  }

  /**
   * Health scoring: rules engine
   */
  private async updateHealthScore(citizen: PluginCitizen) {
    let score = 100;

    // Memory check
    if (citizen.healthSignals.memoryUsage > citizen.memoryQuota) {
      score -= 25;
    } else if (citizen.healthSignals.memoryUsage > citizen.memoryQuota * 0.8) {
      score -= 10;
    }

    // Error rate check
    if (citizen.healthSignals.errorRate > 0.1) {
      score -= 30;
    }

    // Response time check
    if (citizen.healthSignals.responseTime > 5000) {  // 5s
      score -= 15;
    }

    citizen.healthScore = Math.max(0, score);

    // State transitions (with hysteresis to avoid flapping)
    const oldState = citizen.state;
    let newState = oldState;

    if (score >= 80 && oldState !== 'healthy') {
      newState = 'healthy';
    } else if (score >= 50 && score < 80) {
      newState = 'degraded';
    } else if (score < 50) {
      newState = 'isolated';
    }

    if (newState !== oldState) {
      await this.transitionPluginState(citizen, newState);
    }
  }

  /**
   * Enforce isolation: degrade capabilities
   */
  private async transitionPluginState(
    citizen: PluginCitizen,
    newState: string
  ) {
    console.warn(
      `⚠️ Plugin ${citizen.pluginId} transitioned to ${newState}`
    );

    citizen.transitions.push({
      from: citizen.state,
      to: newState,
      reason: `Health score ${citizen.healthScore}`,
      timestamp: Date.now()
    });

    citizen.state = newState;

    switch (newState) {
      case 'healthy':
        await this.restoreCapabilities(citizen);
        break;

      case 'degraded':
        // Increase monitoring, reduce quotas
        await this.throttlePlugin(citizen, 0.5);
        this.observability.record({
          event: 'plugin_degraded',
          pluginId: citizen.pluginId,
          reason: `Health score ${citizen.healthScore}`,
          action: 'throttled 50%'
        });
        break;

      case 'isolated':
        // Severe throttling, sandbox tightening
        await this.throttlePlugin(citizen, 0.1);
        await this.tightenSandbox(citizen);
        this.observability.record({
          event: 'plugin_isolated',
          pluginId: citizen.pluginId,
          reason: `Health score ${citizen.healthScore}`,
          action: 'isolated to 10% quota'
        });
        break;

      case 'quarantined':
        // Last resort: disable plugin, preserve system
        await this.disablePlugin(citizen);
        this.observability.record({
          event: 'plugin_quarantined',
          pluginId: citizen.pluginId,
          reason: citizen.healthSignals.errorRate > 0.5
        });
        break;
    }
  }

  /**
   * Throttle policy
   */
  private async throttlePlugin(citizen: PluginCitizen, factor: number) {
    citizen.memoryQuota = Math.ceil(citizen.memoryQuota * factor);
    citizen.cpuTimeQuota = Math.ceil(citizen.cpuTimeQuota * factor);
    citizen.ioQuota = Math.ceil(citizen.ioQuota * factor);
  }

  /**
   * Sandbox tightening: disable risky operations
   */
  private async tightenSandbox(citizen: PluginCitizen) {
    // Disable capabilities plugin declared but shouldn't use
    if (citizen.manifest.capabilities?.includes('storage:write')) {
      // Only allow reads, block writes
      // (implementation in permission layer)
    }
  }

  /**
   * Observability: expose health to UI
   */
  public getHealthDashboard() {
    return Array.from(this.citizens.values()).map(c => ({
      pluginId: c.pluginId,
      name: c.manifest.name,
      state: c.state,
      healthScore: c.healthScore,
      memoryUsage: `${c.healthSignals.memoryUsage}MB / ${c.memoryQuota}MB`,
      errorRate: `${(c.healthSignals.errorRate * 100).toFixed(1)}%`,
      transitions: c.transitions.slice(-3)  // Last 3 state changes
    }));
  }
}
```

---

## Layer 3: Kernel Self-Healing Actions

The kernel takes **automatic corrective actions** without waiting for user:

```typescript
// apps/kernel/src/self-healing/kernel-policies.ts

class KernelSelfHealingPolicy {
  /**
   * On startup: check graph integrity
   */
  async onBoot() {
    const issues: Issue[] = [];

    // Check 1: CRDT snapshot alive?
    const crdtHealth = await this.verifyCRDTSnapshot();
    if (!crdtHealth.ok) {
      issues.push({
        severity: 'critical',
        category: 'crdt_corruption',
        message: crdtHealth.error
      });
      
      // Recovery: replay WAL
      await this.recoverFromWAL();
    }

    // Check 2: Schema consistency?
    const schemaHealth = await this.verifySchemaConsistency();
    if (!schemaHealth.ok) {
      issues.push({
        severity: 'high',
        category: 'schema_mismatch',
        message: schemaHealth.error
      });
      
      // Recovery: mark for upcast on next read
      await this.markForSchemaUpcast();
    }

    // Check 3: Plugin quotas?
    const quotaHealth = await this.verifyPluginQuotas();
    if (!quotaHealth.ok) {
      issues.push({
        severity: 'medium',
        category: 'quota_exceeded',
        message: quotaHealth.error
      });
      
      // Recovery: adjust quotas intelligently
      await this.recalibrateQuotas();
    }

    // Report issues
    for (const issue of issues) {
      this.observability.record({
        event: 'self_healing_action',
        ...issue
      });
    }
  }

  /**
   * Periodic (every 5 min): proactive checks
   */
  startPeriodicHealthCheck() {
    setInterval(async () => {
      const before = this.kernel.graph.export();

      try {
        // Validate graph structure
        await this.validateGraphInvariants();
        
        // Check plugin citizenship
        const citizens = this.citizenshipMonitor.getAll();
        for (const citizen of citizens) {
          if (citizen.state === 'degraded' || citizen.state === 'isolated') {
            // Alert user but continue
            console.warn(`⚠️ Plugin ${citizen.pluginId} in state ${citizen.state}`);
          }
        }
      } catch (e) {
        // Silent failure: log but don't crash
        this.observability.record({
          event: 'health_check_failed',
          error: e.message
        });
        
        // Attempt recovery
        await this.rollbackToLastGood();
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Whenever plugin fails: attempt containment
   */
  async onPluginError(pluginId: string, error: Error) {
    const citizen = this.citizenshipMonitor.getCitizen(pluginId);

    // Report to citizenship (updates health score)
    await this.citizenshipMonitor.reportOperation(pluginId, {
      name: 'error_caught',
      duration: 0,
      memoryDelta: 0,
      success: false,
      error
    });

    // If high-severity error: isolate immediately
    if (this.isHighSeverity(error)) {
      await this.citizenshipMonitor.transitionPluginState(citizen, 'isolated');
      
      // Attempt to undo last operation
      const lastGoodCommit = await this.kernel.graph.getLastCommitBefore(
        citizen.lastFailureTime
      );
      await this.kernel.graph.revert(lastGoodCommit.id);
    }
  }

  private isHighSeverity(error: Error): boolean {
    return error.message.includes('CRDT') ||
           error.message.includes('quota exceeded') ||
           error.message.includes('corruption');
  }
}
```

---

## Integration with Micro-Kernel (ADR-017)

### In the Plugin Loader Lifecycle

```typescript
// apps/kernel/src/plugin-loader.ts

export class PluginLoader {
  private citizenshipMonitor: PluginCitizenshipMonitor;
  private selfHealing: KernelSelfHealingPolicy;

  /**
   * Step 1: Register plugin (citizen)
   */
  async load(manifestPath: string) {
    const manifest = await this.readManifest(manifestPath);
    
    // Register with citizenship monitoring
    await this.citizenshipMonitor.onPluginLoad(manifest.id, manifest);

    // Continue normal loading...
    const plugin = await this.createPluginInstance(manifest);
    return plugin;
  }

  /**
   * Step 2: Wrap plugin calls with monitoring
   */
  async executeCapability(
    pluginId: string,
    capabilityName: string,
    args: any[]
  ): Promise<any> {
    const startMemory = performance.memory?.usedJSHeapSize ?? 0;
    const startTime = performance.now();

    try {
      const plugin = this.plugins.get(pluginId);
      const result = await plugin[capabilityName](...args);

      // Report success
      const endTime = performance.now();
      const endMemory = performance.memory?.usedJSHeapSize ?? 0;

      await this.citizenshipMonitor.reportOperation(pluginId, {
        name: capabilityName,
        duration: endTime - startTime,
        memoryDelta: endMemory - startMemory,
        success: true
      });

      return result;

    } catch (error) {
      // Report failure + attempt containment
      await this.selfHealing.onPluginError(pluginId, error);
      throw error;
    }
  }

  /**
   * Step 3: Unload with cleanup
   */
  async unload(pluginId: string) {
    await this.citizenshipMonitor.recordPluginUnload(pluginId);
    await this.plugins.get(pluginId).destroy();
    this.plugins.delete(pluginId);
  }
}
```

---

## Architecture Diagram: Low to High Level

```
┌─────────────────────────────────────────────────────────────────┐
│                        KERNEL (Non-Negotiable)                   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ LAYER 3: Policy & Observability (Self-Healing Actions)  │    │
│  │  - onBoot(): check CRDT, schema, quotas                 │    │
│  │  - Periodic: proactive health checks every 5min         │    │
│  │  - onPluginError(): isolate, revert, contain            │    │
│  │  - Expose health dashboard to Studio UI                 │    │
│  └─────────────────────────────────────────────────────────┘    │
│                            ↓                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ LAYER 2: Plugin Citizenship Monitoring                   │    │
│  │  - Track: memory, CPU, I/O, error rate per plugin       │    │
│  │  - Health score: 0-100 (rules-based)                    │    │
│  │  - State machine: healthy → degraded → isolated → quarantine  │
│  │  - Actions: throttle, tighten sandbox, disable          │    │
│  └─────────────────────────────────────────────────────────┘    │
│                            ↓                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ LAYER 1: Storage & CRDT Self-Healing                    │    │
│  │  - Checksums on write (BLAKE3)                          │    │
│  │  - Write-ahead logging (WAL)                            │    │
│  │  - Snapshot isolation + replay                          │    │
│  │  - Schema validation + fallback/downgrade               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                            ↓                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ PERSISTENCE (IndexedDB + OPFS)                          │    │
│  │  - CRDT state with checksums                            │    │
│  │  - Write-ahead log                                      │    │
│  │  - SQLite database + integrity check                    │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│                    PLUGINS (First-Class Citizens)                 │
│                                                                   │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐         │
│  │   Storage:v1 │   │   Sync:v1    │   │ Identity:v1  │        │
│  │              │   │              │   │              │        │
│  │ State:       │   │ State:       │   │ State:       │        │
│  │ healthy      │   │ degraded     │   │ isolated     │        │
│  │ Score: 95    │   │ Score: 60    │   │ Score: 20    │        │
│  └──────────────┘   └──────────────┘   └──────────────┘        │
│                                                                   │
│  All tracked by PluginCitizenshipMonitor (in Kernel)            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Why This Is Part of Kernel (Not a Plugin)

| Aspect | Explanation |
|--------|-------------|
| **Can't be a plugin** | A broken plugin can't heal itself; needs independent authority |
| **Must be non-optional** | All data must be protected; can't be opt-in |
| **Needs full visibility** | Must see all plugin operations and storage state |
| **Needs enforcement power** | Must isolate/disable plugins; plugins can't override |

---

## Testing Strategy

```typescript
// apps/kernel/test/self-healing.integration.test.ts

describe('Self-Healing Integration', () => {

  // Layer 1: Storage healing
  test('corrupted CRDT snapshot detected and repaired', async () => {
    // 1. Create commit (good state)
    // 2. Corrupt CRDT bytes in IndexedDB
    // 3. Boot kernel
    // 4. Verify: kernel detected, replayed from WAL, recovered state
  });

  test('schema version mismatch triggers downgrade', async () => {
    // 1. Store node in v0 schema
    // 2. Upgrade app to v1
    // 3. Read old node
    // 4. Verify: upcast attempts, if fails downgrade fallback
  });

  // Layer 2: Plugin citizenship
  test('plugin exceeding memory quota is throttled', async () => {
    const plugin = new BadMemoryPlugin();  // Allocates 100MB
    plugin.quota = 64;
    
    // Execute: health score decreases
    for (let i = 0; i < 100; i++) {
      await kernel.executeCapability(plugin.id, 'doWork');
    }

    // Verify: plugin transitioned to degraded/isolated
    const citizen = monitor.getCitizen(plugin.id);
    expect(citizen.state).toBe('degraded');
    expect(citizen.memoryQuota).toBeLessThan(64);  // Throttled
  });

  test('plugin with high error rate is isolated', async () => {
    const plugin = new FaultyPlugin();  // Fails 50% of time
    
    // Execute: health score decreases
    for (let i = 0; i < 20; i++) {
      try {
        await kernel.executeCapability(plugin.id, 'unreliableWork');
      } catch (e) {
        // Expected
      }
    }

    // Verify: isolated
    const citizen = monitor.getCitizen(plugin.id);
    expect(citizen.state).toBe('isolated');
  });

  // Layer 3: Kernel policies
  test('critical error triggers automatic revert', async () => {
    // 1. Create good commit
    // 2. Load bad plugin that corrupts CRDT
    // 3. Plugin errors out
    // 4. Verify: kernel automatically reverts to good state
  });

  test('boot health check recovers from crash', async () => {
    // 1. Boot kernel, create some data
    // 2. Kill process mid-operation
    // 3. Boot again
    // 4. Verify: boot checks WAL, recovers state
  });
});
```

---

## Open Questions

1. **User notification**: How much should we expose to UI? Full detail vs. simplified health status?
2. **Recovery policies**: Auto-isolate vs. ask user first?
3. **Cross-device healing**: If Device A detects corruption, should it warn Device B?
4. **Plugin override**: Can a plugin declare "I know I'm using lots of memory, that's OK"?

---

## References

- [CRDT Semantics](https://crdt.tech/)
- [Write-Ahead Logging](https://en.wikipedia.org/wiki/Write-ahead_logging)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Observability Signals](https://opentelemetry.io/)
