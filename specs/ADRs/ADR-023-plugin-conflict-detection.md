# ADR-023: Plugin Conflict Detection and Resolution

**Status**: ✏️ PROPOSED (Design Phase)  
**Date**: 2026-03-07  
**Deciders**: Core Team  
**Related**: ADR-017 (Micro-kernel), ADR-022 (Policy Declarations), ADR-018 (Capability Contracts)  
**Target Version**: v0.2.0-0.3.0

---

## Context

**Problem learned from other ecosystems**:

Multiple plugins can modify the same graph data without coordination, causing:
1. **Silent conflicts**: Two task manager plugins both manage `priority` field → last write wins, user doesn't know
2. **Data corruption**: Plugin A writes `status: "done"`, Plugin B overwrites with `status: "archived"` immediately
3. **Debugging nightmare**: User doesn't know which plugin caused unexpected behavior
4. **Plugin interference**: Plugin A's logic broken because Plugin B changed data it depends on

**Real-world examples**:
- **WordPress**: Two SEO plugins conflict → site breaks, no indication which plugin responsible
- **VSCode**: Multiple formatters fight over same file → formatting flips on every save
- **Jenkins**: Build plugins conflict over workspace directory → build artifacts corrupted

**Current Refarm state**: No conflict detection. Two plugins can install and silently conflict.

---

## Decision

**Plugins declare "write paths" in manifest: which graph fields they will modify.**

Kernel detects conflicts at:
1. **Install time**: Before plugin installed, check if conflicts with existing plugins
2. **Runtime**: Detect when two plugins both modify same data (audit trail)
3. **User resolution**: Let user choose conflict resolution strategy

---

## Manifest Extension: `writeAccess` Field

```jsonc
{
  "id": "io.refarm.task-manager-a",
  "name": "Task Manager A",
  "version": "1.0.0",
  
  "capabilities": ["storage:write"],
  
  // NEW: Declare which fields plugin will modify
  "writeAccess": {
    "nodes": {
      "task": {                       // Node type
        "fields": ["priority", "status", "assignee"],
        "creates": true,              // Can create new task nodes
        "deletes": false              // Cannot delete task nodes
      }
    },
    "edges": {
      "task-dependency": {            // Edge type
        "creates": true,
        "deletes": true
      }
    }
  },
  
  // OPTIONAL: Declare compatibility with other plugins
  "conflicts": {
    "canCoexist": [
      "io.refarm.task-calendar"       // Known compatible plugin
    ],
    "mutuallyExclusive": [
      "io.refarm.task-manager-b"      // Cannot run with this plugin
    ]
  }
}
```

---

## Conflict Detection Algorithm

### Phase 1: Install-Time Detection

```typescript
// apps/kernel/src/conflict-detector.ts

class ConflictDetector {
  /**
   * Check if new plugin conflicts with existing plugins
   */
  async detectConflicts(
    newPlugin: PluginManifest,
    installedPlugins: PluginManifest[]
  ): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];
    
    for (const installed of installedPlugins) {
      // Check write path overlap
      const overlap = this.findWritePathOverlap(
        newPlugin.writeAccess,
        installed.writeAccess
      );
      
      if (overlap.length > 0) {
        conflicts.push({
          type: 'write-path-overlap',
          pluginA: newPlugin.id,
          pluginB: installed.id,
          paths: overlap,
          severity: this.calculateSeverity(overlap)
        });
      }
      
      // Check explicit mutual exclusion
      if (newPlugin.conflicts?.mutuallyExclusive?.includes(installed.id)) {
        conflicts.push({
          type: 'mutually-exclusive',
          pluginA: newPlugin.id,
          pluginB: installed.id,
          severity: 'critical'
        });
      }
    }
    
    return conflicts;
  }
  
  /**
   * Find overlapping write paths
   */
  private findWritePathOverlap(
    accessA: WriteAccess,
    accessB: WriteAccess
  ): string[] {
    const overlap: string[] = [];
    
    // Check node field overlap
    for (const [nodeType, configA] of Object.entries(accessA.nodes)) {
      const configB = accessB.nodes[nodeType];
      
      if (configB) {
        // Both plugins write to same node type
        const sharedFields = configA.fields.filter(f => 
          configB.fields.includes(f)
        );
        
        if (sharedFields.length > 0) {
          overlap.push(`nodes.${nodeType}.fields: ${sharedFields.join(', ')}`);
        }
      }
    }
    
    // Check edge type overlap
    for (const edgeType of Object.keys(accessA.edges)) {
      if (accessB.edges[edgeType]) {
        overlap.push(`edges.${edgeType}`);
      }
    }
    
    return overlap;
  }
  
  /**
   * Calculate conflict severity
   */
  private calculateSeverity(overlap: string[]): 'low' | 'medium' | 'high' | 'critical' {
    // Critical: Overlaps on core fields (id, type, created, modified)
    const coreFields = ['id', 'type', 'created', 'modified'];
    if (overlap.some(path => coreFields.some(field => path.includes(field)))) {
      return 'critical';
    }
    
    // High: Overlaps on multiple fields
    if (overlap.length > 3) {
      return 'high';
    }
    
    // Medium: Overlaps on 2-3 fields
    if (overlap.length > 1) {
      return 'medium';
    }
    
    // Low: Overlaps on 1 field
    return 'low';
  }
}
```

---

## User Experience: Conflict Resolution UI

### Scenario: User installing conflicting plugin

```
┌─────────────────────────────────────────────────────────────┐
│ Studio → Plugin Marketplace                                  │
│                                                              │
│ ⚠️  CONFLICT DETECTED                                        │
│                                                              │
│ The plugin "Task Manager B" conflicts with:                 │
│   • Task Manager A (already installed)                      │
│                                                              │
│ Conflicts:                                                   │
│   🔴 Both modify: task.priority                             │
│   🔴 Both modify: task.status                               │
│   🟡 Both modify: task.assignee                             │
│                                                              │
│ Resolution Options:                                          │
│                                                              │
│ ○ Install anyway (both plugins active, last write wins)     │
│   ⚠️ May cause unexpected behavior                          │
│                                                              │
│ ● Replace "Task Manager A" with "Task Manager B"            │
│   ✓ Disables conflicting plugin                             │
│   ℹ️  Your data will be preserved                           │
│                                                              │
│ ○ Cancel installation                                        │
│                                                              │
│ [Show Details] [Continue] [Cancel]                          │
└─────────────────────────────────────────────────────────────┘
```

### Details View

```
┌─────────────────────────────────────────────────────────────┐
│ Conflict Details                                             │
│                                                              │
│ Write Path Overlap:                                          │
│                                                              │
│ task.priority                                                │
│   • Task Manager A: Sets based on due date                  │
│   • Task Manager B: Sets based on user voting               │
│   Recommendation: Choose one approach                        │
│                                                              │
│ task.status                                                  │
│   • Task Manager A: Values: todo|doing|done                 │
│   • Task Manager B: Values: backlog|active|complete         │
│   Recommendation: These are incompatible schemas            │
│                                                              │
│ task.assignee                                                │
│   • Both use same format (user ID)                          │
│   Severity: Low (unlikely to conflict in practice)          │
│                                                              │
│ [Back] [Install Anyway] [Replace Plugin]                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Runtime Conflict Detection

Even if plugins install successfully, detect conflicts at runtime:

```typescript
// apps/kernel/src/graph-monitor.ts

class GraphMonitor {
  /**
   * Monitor graph modifications for conflicts
   */
  async onGraphModified(event: GraphModificationEvent) {
    const { nodeId, nodeBefore, nodeAfter, pluginId } = event;
    
    // Check if another plugin recently modified same node
    const recentModifications = await this.getRecentModifications(
      nodeId,
      { within: '5 seconds' }
    );
    
    const otherPluginMods = recentModifications.filter(
      mod => mod.pluginId !== pluginId
    );
    
    if (otherPluginMods.length > 0) {
      // Conflict detected: Two plugins modified same node within 5 seconds
      
      for (const otherMod of otherPluginMods) {
        // Check if they modified same field
        const sharedFields = this.findModifiedFields(nodeBefore, nodeAfter)
          .filter(field => 
            this.findModifiedFields(otherMod.before, otherMod.after).includes(field)
          );
        
        if (sharedFields.length > 0) {
          // Conflict on specific fields
          await this.reportConflict({
            type: 'runtime-conflict',
            nodeId,
            field: sharedFields,
            pluginA: otherMod.pluginId,
            pluginB: pluginId,
            timestamp: Date.now()
          });
          
          // Notify user
          this.studio.notify({
            type: 'warning',
            title: 'Plugin Conflict Detected',
            message: `"${pluginId}" and "${otherMod.pluginId}" both modified ${nodeId}.${sharedFields.join(', ')}`,
            actions: [
              { label: 'Show Details', action: 'show-conflict-log' },
              { label: 'Disable One Plugin', action: 'resolve-conflict' }
            ]
          });
        }
      }
    }
  }
  
  /**
   * Find which fields were modified
   */
  private findModifiedFields(before: Node, after: Node): string[] {
    const modified: string[] = [];
    
    for (const key of Object.keys(after)) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        modified.push(key);
      }
    }
    
    return modified;
  }
}
```

---

## Conflict Resolution Strategies

### Strategy 1: **Priority-Based** (User-Defined)

User assigns priority to plugins:

```jsonc
{
  "conflictResolution": {
    "strategy": "priority",
    "priorities": [
      { "plugin": "io.refarm.task-manager-a", "priority": 1 },
      { "plugin": "io.refarm.task-manager-b", "priority": 2 }
    ]
  }
}
```

When conflict:
- Plugin A writes → accepted
- Plugin B writes → rejected (or logged as warning)

### Strategy 2: **Last-Write-Wins** (CRDT Default)

No special handling, CRDT resolves:
- Both plugins write
- Last write wins (CRDT timestamp)
- User sees final result (may be unexpected)

### Strategy 3: **Merge** (Field-Level)

Plugins don't conflict on entire node, only specific fields:

```typescript
// Plugin A modifies task.priority
await graph.upsertNode({ id: 'task-1', priority: 'high' });

// Plugin B modifies task.assignee (no conflict)
await graph.upsertNode({ id: 'task-1', assignee: 'alice' });

// Result: Both succeed (different fields)
// { id: 'task-1', priority: 'high', assignee: 'alice' }
```

### Strategy 4: **Mutual Exclusion** (Disable One)

User installs Plugin B → automatically disables Plugin A:

```typescript
{
  "conflicts": {
    "mutuallyExclusive": ["io.refarm.task-manager-a"]
  }
}
```

---

## Observability Integration (ADR-007)

Conflict log in Studio DevTools:

```
┌─────────────────────────────────────────────────────────────┐
│ Studio → DevTools → Conflicts                                │
│                                                              │
│ Runtime Conflicts (Last 24 Hours):                          │
│                                                              │
│ 2026-03-07 14:32:15                                         │
│   Node: task-123                                             │
│   Field: priority                                            │
│   Plugin A: Task Manager A → "high"                         │
│   Plugin B: Task Manager B → "p1"                           │
│   Resolution: Last write wins (Plugin B)                     │
│   [Show Diff] [Revert]                                       │
│                                                              │
│ 2026-03-07 14:30:42                                         │
│   Node: task-456                                             │
│   Field: status                                              │
│   Plugin A: Task Manager A → "done"                         │
│   Plugin B: Task Manager B → "complete"                     │
│   Resolution: Last write wins (Plugin B)                     │
│   [Show Diff] [Revert]                                       │
│                                                              │
│ Install-Time Conflicts:                                      │
│   None                                                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Graph Versioning Integration (ADR-020)

If conflict detected, user can revert:

```typescript
// Revert to before Plugin B installation
await graph.checkout('commit-before-plugin-b');

// Or revert specific field
await graph.revert({
  nodeId: 'task-123',
  field: 'priority',
  toCommit: 'before-plugin-b-write'
});
```

---

## Implementation Phases

### Phase 1: Manifest Schema (v0.2.0)

```
[ ] Extend plugin-manifest with `writeAccess` field
[ ] JSON schema validation for writeAccess declarations
[ ] ConflictDetector class in kernel
[ ] Install-time conflict detection
```

### Phase 2: UI (v0.2.0)

```
[ ] Conflict warning dialog (install time)
[ ] Resolution options (install anyway, replace, cancel)
[ ] Conflict details view
```

### Phase 3: Runtime Detection (v0.3.0)

```
[ ] GraphMonitor tracks modifications
[ ] Runtime conflict detection (5-second window)
[ ] Conflict notifications
[ ] Conflict log in DevTools
```

### Phase 4: Advanced Resolution (v0.3.0+)

```
[ ] Priority-based resolution
[ ] Field-level merge strategies
[ ] Automatic conflict resolution policies
[ ] Graph versioning integration (revert conflicts)
```

---

## Testing Strategy

### Test 1: Install-Time Conflict

```typescript
test('installing conflicting plugin shows warning', async () => {
  // Install Plugin A (manages task.priority)
  await kernel.installPlugin('task-manager-a');
  
  // Try to install Plugin B (also manages task.priority)
  const result = await kernel.installPlugin('task-manager-b');
  
  expect(result.conflicts).toHaveLength(1);
  expect(result.conflicts[0].type).toBe('write-path-overlap');
  expect(result.conflicts[0].paths).toContain('nodes.task.fields: priority');
});
```

### Test 2: Runtime Conflict

```typescript
test('runtime conflict detected when two plugins modify same field', async () => {
  await kernel.installPlugin('task-manager-a');
  await kernel.installPlugin('task-manager-b', { 
    conflictResolution: 'allow' 
  });
  
  const monitor = kernel.getGraphMonitor();
  const conflicts: Conflict[] = [];
  
  monitor.on('conflict', (c) => conflicts.push(c));
  
  // Plugin A modifies task
  await pluginA.execute('setTaskPriority', { taskId: 'task-1', priority: 'high' });
  
  // Plugin B modifies same task immediately
  await pluginB.execute('setTaskPriority', { taskId: 'task-1', priority: 'p1' });
  
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].field).toContain('priority');
});
```

### Test 3: Mutual Exclusion

```typescript
test('mutually exclusive plugins cannot coexist', async () => {
  await kernel.installPlugin('task-manager-a');
  
  const result = await kernel.installPlugin('task-manager-b', {
    manifest: {
      conflicts: {
        mutuallyExclusive: ['task-manager-a']
      }
    }
  });
  
  expect(result.requiresResolution).toBe(true);
  expect(result.resolutionOptions).toContain('replace-existing');
});
```

---

## Open Questions

1. **Granularity**: Should conflict detection be per-field or per-node?
   - **Proposed**: Per-field (more granular, fewer false positives)

2. **Performance**: Tracking all modifications has overhead. How to optimize?
   - **Proposed**: In-memory LRU cache (last 1000 modifications), async persistence

3. **False Positives**: Two plugins write same field with same value (no actual conflict)
   - **Proposed**: Compare values, only report if different

4. **Cross-Device**: Plugin A on Device 1, Plugin B on Device 2 → conflict during sync
   - **Proposed**: Sync conflict resolution (CRDT handles, but log for user visibility)

---

## Success Metrics

- ✅ Zero silent conflicts (all conflicts detected + reported)
- ✅ 95%+ conflict detection accuracy (low false positives)
- ✅ < 5ms overhead per graph modification (conflict checking is fast)
- ✅ User understands conflicts (clear UI messaging)

---

## References

- [VSCode Extension Conflicts](https://github.com/microsoft/vscode/issues/12764)
- [WordPress Plugin Conflicts](https://wordpress.org/support/article/faq-troubleshooting/#how-to-deactivate-all-plugins-when-not-able-to-access-the-administrative-menus)
- [Jenkins Plugin Dependency Resolution](https://www.jenkins.io/doc/developer/plugin-development/dependency-management/)
- [ADR-017: Micro-Kernel](ADR-017-studio-micro-kernel-and-plugin-boundary.md)
- [ADR-018: Capability Contracts](ADR-018-capability-contracts-and-observability-gates.md)
- [ADR-022: Policy Declarations](ADR-022-policy-declarations-in-plugin-manifests.md)
