# ADR-022: Policy Declarations in Plugin Manifests

**Status**: ✏️ PROPOSED (Design Phase)  
**Date**: 2026-03-07  
**Deciders**: Core Team  
**Related**: ADR-017 (Micro-kernel), ADR-021 (Self-Healing), ADR-018 (Capability Contracts)  
**Target Version**: v0.3.0+

---

## Context

Plugins need to declare **resource policies** upfront so the kernel can:

1. **Prevent quota exhaustion** (e.g., "I'll never use more than 64MB")
2. **Allow user configuration** (e.g., "Warn me when storage grows exponentially")
3. **Enable dynamic enforcement** (e.g., "Auto-compress my data if > 50MB")
4. **Provide transparency** (e.g., "Show me which plugin uses most memory")

**Current State**: Plugin manifests declare capabilities they *need* (e.g., `storage:write`) but not policies they *enforce*.

**Problem**:

- User doesn't know which plugins are resource-heavy
- Kernel can't enforce quotas declared by plugins
- No way to configure plugin behavior (e.g., "be more aggressive with compression")

---

## Decision

**Extend plugin manifests to support policy declarations. Policies are:**

1. **Declarative** (JSON schema in manifest)
2. **User-configurable** (Studio UI exposes knobs)
3. **Kernel-enforced** (if plugin violates, isolation kicks in)
4. **Observable** (policies show up in Resource Observatory)

---

## Manifest Extension: `policies` Field

```jsonc
{
  "id": "com.example.resource-observer",
  "name": "Resource Observatory",
  "version": "1.0.0",
  "capabilities": [
    "storage:read",
    "observability:emit"
  ],
  
  // NEW: Policy declarations
  "policies": {
    "resources": {
      "memory": {
        "max": "64MB",                    // Hard limit
        "warning": "48MB",                 // Warn before hitting limit
        "strategy": "throttle"             // What to do at limit (throttle|reject|compress)
      },
      "storage": {
        "max": "500MB",
        "warning": "400MB",
        "strategy": "archive",             // Archive old data to external storage
        "userConfigurable": true           // User can change limits
      },
      "cpu": {
        "maxTimePerOperation": "500ms",
        "strategy": "defer"                // Defer work to idle time if > 500ms
      }
    },
    
    "behavior": {
      "storageGrowthAlert": {
        "enabled": true,
        "threshold": "exponential",        // Detect exponential growth
        "action": "notify",                // notify|block|archive
        "userConfigurable": true
      },
      "compressionPolicy": {
        "enabled": false,
        "trigger": "50MB",                 // When to start compressing
        "algorithm": "lz4",
        "userConfigurable": true
      }
    },
    
    "licensing": {
      "contentLicense": {
        "default": "CC-BY-4.0",            // Default license for user content
        "options": [
          "CC-BY-4.0",
          "CC-BY-SA-4.0",
          "CC0-1.0",
          "proprietary"
        ],
        "userConfigurable": true,
        "displayBadge": true               // Show badge in Studio UI
      }
    }
  }
}
```

---

## How It Works

### Step 1: Kernel Reads Manifest on Plugin Load

```typescript
// apps/kernel/src/plugin-loader.ts

async loadPlugin(manifestPath: string) {
  const manifest = await readJSON(manifestPath);
  
  // Extract policy declarations
  const policies = manifest.policies ?? {};
  
  // Register with Policy Manager
  this.policyManager.register(manifest.id, policies);
  
  // Expose to user for configuration
  this.studio.showPolicyConfig(manifest.id, policies);
}
```

### Step 2: User Configures Policies in Studio UI

```
┌─────────────────────────────────────────────────┐
│ Studio → Settings → Plugin Policies              │
│                                                  │
│ [Resource Observatory Plugin]                   │
│                                                  │
│  Memory Limit:    [64] MB   (max: 128MB)       │
│  Storage Limit:   [500] MB  (max: 2GB)         │
│  Growth Alert:    [✓] Enabled                   │
│    Threshold:     [Exponential ▼]              │
│    Action:        [Notify ▼]                    │
│                                                  │
│  Content License: [CC-BY-4.0 ▼]                │
│    Show badge:    [✓]                           │
│                                                  │
│  [Save Changes]                                  │
└─────────────────────────────────────────────────┘
```

### Step 3: Kernel Enforces Policies

```typescript
// apps/kernel/src/policy-manager.ts

class PolicyManager {
  private policies: Map<string, PolicyConfig> = new Map();
  
  /**
   * Called by Citizenship Monitor when plugin operates
   */
  async enforce(pluginId: string, operation: PluginOperation) {
    const policy = this.policies.get(pluginId);
    if (!policy) return; // No policy declared
    
    // Example: Memory limit enforcement
    if (operation.memoryDelta > 0) {
      const currentUsage = this.citizenshipMonitor.getMemoryUsage(pluginId);
      const limit = policy.resources.memory.max;
      
      if (currentUsage + operation.memoryDelta > limit) {
        // Enforce strategy
        switch (policy.resources.memory.strategy) {
          case 'throttle':
            this.citizenshipMonitor.throttle(pluginId, 0.5);
            break;
          case 'reject':
            throw new PolicyViolationError(`Plugin ${pluginId} exceeded memory limit`);
          case 'compress':
            await this.compressPluginData(pluginId);
            break;
        }
      }
      
      // Warn user if approaching limit
      if (currentUsage > policy.resources.memory.warning) {
        this.studio.notify({
          type: 'warning',
          message: `Plugin ${pluginId} using ${currentUsage}MB (limit: ${limit}MB)`
        });
      }
    }
    
    // Example: Storage growth alert
    if (policy.behavior.storageGrowthAlert?.enabled) {
      const growth = this.detectGrowthPattern(pluginId);
      
      if (growth === 'exponential') {
        const action = policy.behavior.storageGrowthAlert.action;
        
        switch (action) {
          case 'notify':
            this.studio.notify({
              type: 'alert',
              message: `Storage growing exponentially. Review data in ${pluginId}.`
            });
            break;
          case 'block':
            throw new PolicyViolationError('Storage growth too fast, blocking writes');
          case 'archive':
            await this.archiveOldData(pluginId);
            break;
        }
      }
    }
  }
  
  /**
   * Detect storage growth pattern
   */
  private detectGrowthPattern(pluginId: string): 'linear' | 'exponential' | 'stable' {
    const history = this.storageHistory.get(pluginId);
    
    // Simple heuristic: if last 3 samples doubled each time → exponential
    if (history.length >= 3) {
      const [a, b, c] = history.slice(-3);
      if (b > a * 1.8 && c > b * 1.8) {
        return 'exponential';
      }
    }
    
    return 'linear';
  }
}
```

---

## Example: Resource Observatory Plugin

This plugin would be **practically core** (everyone wants it) but implemented as a plugin to prove the model works.

```typescript
// plugins/resource-observatory/manifest.json
{
  "id": "io.refarm.resource-observatory",
  "name": "Resource Observatory",
  "version": "1.0.0",
  "capabilities": [
    "storage:read",
    "observability:emit",
    "ui:dashboard"
  ],
  
  "policies": {
    "resources": {
      "memory": {
        "max": "32MB",                 // Plugin itself is lightweight
        "warning": "24MB",
        "strategy": "throttle"
      }
    },
    
    "behavior": {
      "storageGrowthAlert": {
        "enabled": true,
        "threshold": "exponential",
        "action": "notify",
        "userConfigurable": true
      },
      "quotaMonitoring": {
        "enabled": true,
        "warnAt": "60%",               // Warn when 60% of OPFS quota used
        "blockAt": "95%",              // Block writes at 95%
        "userConfigurable": true
      }
    }
  },
  
  "ui": {
    "dashboard": {
      "name": "Resource Dashboard",
      "path": "/dashboard/resources"
    }
  }
}
```

**What it does**:

1. Monitors OPFS quota usage (via `navigator.storage.estimate()`)
2. Warns user when approaching 60% full
3. Blocks new writes at 95% (preserves system integrity)
4. Detects exponential storage growth (alerts user proactively)
5. Shows per-plugin breakdown (which plugin using most space)

**Why it's a plugin, not kernel**:

- User can replace with custom monitoring solution
- Different users have different needs (some want Grafana, some want simple UI)
- Proves extensibility model works

**Why it's "practically core"**:

- 99% of users want this
- Ships with Studio by default (opt-out, not opt-in)
- Documentation treats it as essential

---

## Example: License Selector Plugin

```typescript
// plugins/license-selector/manifest.json
{
  "id": "io.refarm.license-selector",
  "name": "Content License Selector",
  "version": "1.0.0",
  "capabilities": [
    "graph:metadata:write",
    "ui:settings"
  ],
  
  "policies": {
    "licensing": {
      "contentLicense": {
        "default": "CC-BY-4.0",
        "options": [
          "CC-BY-4.0",
          "CC-BY-SA-4.0",
          "CC-BY-NC-4.0",
          "CC0-1.0",
          "MIT",
          "proprietary",
          "unlicensed"
        ],
        "userConfigurable": true,
        "displayBadge": true,
        "scope": "per-node"             // License per node, not global
      }
    }
  },
  
  "ui": {
    "nodeActions": [
      {
        "label": "Set License",
        "action": "showLicenseDialog"
      }
    ]
  }
}
```

**What it does**:

1. User right-clicks a node → "Set License"
2. Dialog shows license options (Creative Commons, MIT, proprietary, etc.)
3. Plugin writes license metadata to node
4. Studio displays license badge next to node
5. When node is exported/shared, license is preserved

---

## Benefits of This Approach

### 1. Decoupled from Kernel

- Kernel doesn't need to know about licenses, compression, archiving
- Policies are data-driven (manifest), not code

### 2. User Control

- User configures policies in Studio UI
- User can disable/enable policies per plugin
- User can install alternative implementations

### 3. Transparency

- Policies visible in manifest (before install)
- User knows what plugin will do before trusting it
- Resource Observatory shows violations

### 4. Ecosystem-Friendly

- Third-party plugins can declare policies
- Marketplace can filter by policies (e.g., "only show lightweight plugins")
- Kernel enforces policies consistently

---

## Extension: Performance Budgets

**Problem learned from ecosystems** (VSCode, Electron, Jupyter):

Plugins can be arbitrarily slow, causing:

- **UI freezes**: Plugin runs expensive operation on main thread → 5 second freeze
- **Startup delays**: 20 plugins each take 500ms → 10 second startup
- **Janky interactions**: Plugin runs on every keystroke, takes 200ms → typing feels slow

**Solution**: Plugins declare **performance budgets** in manifest.

### Manifest Extension: `performance` Field

```jsonc
{
  "id": "io.refarm.canvas-renderer",
  "name": "Canvas Renderer",
  "version": "1.0.0",
  
  "policies": {
    "performance": {
      "startup": {
        "maxTime": "100ms",              // Must initialize in < 100ms
        "critical": false                 // Not required for app boot
      },
      "operations": {
        "render": {
          "maxTime": "16ms",             // 60fps guarantee
          "frequency": "on-every-frame", // How often called
          "priority": "high"             // high|medium|low
        },
        "save": {
          "maxTime": "500ms",
          "frequency": "user-initiated",
          "priority": "medium"
        },
        "search": {
          "maxTime": "100ms",
          "frequency": "on-typing",      // Called on every keystroke
          "priority": "high"
        }
      },
      "monitoring": {
        "enabled": true,                 // Kernel tracks actual performance
        "reportViolations": true,        // Report to user if exceeds budget
        "enforcementStrategy": "throttle" // throttle|warn|disable
      }
    }
  }
}
```

### Performance Monitoring

Kernel tracks actual performance vs. declared budget:

```typescript
// apps/kernel/src/performance-monitor.ts

class PerformanceMonitor {
  private budgets: Map<string, PerformanceBudget> = new Map();
  private violations: Map<string, Violation[]> = new Map();
  
  /**
   * Track plugin operation performance
   */
  async trackOperation(
    pluginId: string,
    operationName: string,
    actualTime: number
  ) {
    const budget = this.budgets.get(pluginId)?.operations[operationName];
    
    if (!budget) return; // No budget declared
    
    const maxTime = this.parseTime(budget.maxTime);
    
    if (actualTime > maxTime) {
      // Budget exceeded
      const violation = {
        pluginId,
        operation: operationName,
        budgeted: maxTime,
        actual: actualTime,
        timestamp: Date.now(),
        severity: this.calculateSeverity(actualTime, maxTime)
      };
      
      this.recordViolation(pluginId, violation);
      
      // Enforce strategy
      const strategy = budget.enforcementStrategy ?? 'warn';
      
      switch (strategy) {
        case 'throttle':
          // Reduce plugin execution frequency
          this.citizenshipMonitor.throttle(pluginId, 0.5);
          break;
          
        case 'warn':
          // Notify user
          this.studio.notify({
            type: 'performance-warning',
            message: `Plugin "${pluginId}" exceeded performance budget`,
            details: `Operation "${operationName}" took ${actualTime}ms (budget: ${maxTime}ms)`
          });
          break;
          
        case 'disable':
          // Disable plugin if repeatedly violates
          const recentViolations = this.getRecentViolations(pluginId, { within: '5 minutes' });
          
          if (recentViolations.length > 10) {
            await this.kernel.disablePlugin(pluginId, {
              reason: 'repeated-performance-violations',
              canReenable: true
            });
          }
          break;
      }
    }
  }
  
  /**
   * Calculate violation severity
   */
  private calculateSeverity(
    actual: number,
    budgeted: number
  ): 'low' | 'medium' | 'high' | 'critical' {
    const ratio = actual / budgeted;
    
    if (ratio > 10) return 'critical';  // 10x over budget
    if (ratio > 5) return 'high';       // 5x over budget
    if (ratio > 2) return 'medium';     // 2x over budget
    return 'low';                       // < 2x over budget
  }
}
```

### User Experience: Performance Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│ Studio → DevTools → Performance                              │
│                                                              │
│ Plugin Performance (Last Hour):                             │
│                                                              │
│ ✅ Canvas Renderer                                           │
│    render: avg 12ms (budget: 16ms)  [✓ Within budget]      │
│    save:   avg 450ms (budget: 500ms) [✓ Within budget]     │
│                                                              │
│ ⚠️  Search Plugin                                            │
│    search: avg 150ms (budget: 100ms) [⚠️  50% over budget]  │
│    Violations: 23 in last hour                              │
│    [Show Details] [Adjust Budget] [Disable Plugin]          │
│                                                              │
│ 🔴 Heavy Analyzer                                            │
│    analyze: avg 2000ms (budget: 500ms) [🔴 4x over budget]  │
│    Violations: 102 in last hour                             │
│    Status: Auto-throttled (50% frequency)                   │
│    [Show Details] [Disable Plugin]                          │
│                                                              │
│ Aggregate Stats:                                             │
│   Total time in plugins: 12.3s                              │
│   Violations: 125 (23 medium, 102 high)                     │
│   Throttled plugins: 1                                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Testing Performance Budgets

```typescript
test('plugin exceeding performance budget is throttled', async () => {
  const plugin = await kernel.loadPlugin({
    id: 'slow-plugin',
    policies: {
      performance: {
        operations: {
          process: {
            maxTime: '100ms',
            enforcementStrategy: 'throttle'
          }
        }
      }
    }
  });
  
  // Simulate slow operation (500ms, 5x over budget)
  await plugin.execute('process', async () => {
    await sleep(500);
  });
  
  // Should be throttled
  const citizenship = kernel.getCitizenshipStatus(plugin.id);
  expect(citizenship.throttled).toBe(true);
  expect(citizenship.throttleRatio).toBe(0.5); // 50% frequency
});
```

### Benefits

1. **Prevents UI freezes**: Plugins that violate budgets are throttled
2. **Fast startup**: Critical plugins have strict budgets, non-critical can defer
3. **User visibility**: Performance dashboard shows slow plugins
4. **Developer feedback**: Plugin authors see violations during testing
5. **Ecosystem quality**: Marketplace can badge "⚡ Fast" plugins

---

## Implementation Plan

### Phase 1: Manifest Schema (v0.2.0)

```
[ ] Extend plugin-manifest package with `policies` field
[ ] JSON schema validation for policies
[ ] Policy parsing + validation in kernel
[ ] Studio UI for policy configuration
```

### Phase 2: Policy Enforcement (v0.3.0)

```
[ ] PolicyManager class in kernel
[ ] Integration with CitizenshipMonitor (ADR-021)
[ ] Enforcement strategies (throttle, reject, compress, archive)
[ ] User notifications for violations
```

### Phase 3: Default Plugins (v0.3.0)

```
[ ] Resource Observatory plugin (reference implementation)
[ ] License Selector plugin (reference implementation)
[ ] Documentation: "How to Write a Policy Plugin"
```

---

## Open Questions

1. **Conflict Resolution**: What if two plugins declare conflicting policies?
   - Proposed: User chooses which plugin wins (priority system)

2. **Policy Versioning**: How do policies evolve over time?
   - Proposed: Policies have version field, kernel migrates old → new

3. **Marketplace**: How to display policies in plugin marketplace?
   - Proposed: Policy badges (e.g., "🟢 Lightweight", "🔴 Heavy Resource Use")

4. **Security**: Can malicious plugin declare fake policies?
   - Proposed: Kernel validates policies, user sees both declared + actual behavior

---

## References

- [ADR-017: Micro-Kernel](ADR-017-studio-micro-kernel-and-plugin-boundary.md)
- [ADR-021: Plugin Citizenship](ADR-021-self-healing-and-plugin-citizenship.md)
- [Plugin Manifest Schema](../../packages/plugin-manifest/README.md)
