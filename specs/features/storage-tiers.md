# Feature: Storage Tiers

**Status**: Draft  
**Version**: v0.1.0  
**Owner**: Core Team

---

## Summary

Storage Tiers provide three distinct persistence strategies for user data: ephemeral (memory-only), persistent (OPFS single-device), and synced (OPFS + CRDT multi-device). This allows users to choose their own privacy/convenience trade-off without requiring an account upfront, supporting Refarm's identity-orthogonal architecture.

---

## User Stories

### Story 1: Privacy-First User

**As a** privacy-conscious user  
**I want** to use ephemeral storage that leaves no trace  
**So that** I can experiment without any data persisting on disk

### Story 2: Single-Device User

**As a** user who primarily uses one device  
**I want** persistent storage without sync overhead  
**So that** my data survives browser restarts without extra complexity

### Story 3: Multi-Device User

**As a** user who works across laptop and phone  
**I want** synced storage with automatic conflict resolution  
**So that** my data stays in sync seamlessly

### Story 4: Tier Migration

**As a** user who started with ephemeral  
**I want** to upgrade to persistent or synced later  
**So that** I'm not locked into my initial choice

---

## Acceptance Criteria

### AC1: Ephemeral Tier Behavior

1. **Given** user selects ephemeral tier  
   **When** they create/edit data  
   **Then** data resides only in JavaScript memory
   - No OPFS writes
   - No localStorage writes (except session metadata)
   - Cleared on page reload

2. **Given** ephemeral tier active  
   **When** user reloads page  
   **Then** vault is empty (data lost)

### AC2: Persistent Tier Behavior

3. **Given** user selects persistent tier  
   **When** they create/edit data  
   **Then** data is written to OPFS immediately
   - SQLite database in OPFS
   - WAL mode for reliability
   - Quota managed proactively

4. **Given** persistent tier active  
   **When** user reloads page  
   **Then** vault is restored from OPFS (data preserved)

### AC3: Synced Tier Behavior

5. **Given** user selects synced tier  
   **When** they create/edit data  
   **Then** data written to OPFS + CRDT state
   - SQLite for persistence
   - Yjs for conflict-free sync
   - Sync code displayed for manual device pairing

6. **Given** synced tier active on device A  
   **When** same user makes edits on device B (same vault)  
   **Then** changes merge automatically via CRDT
   - No conflicts (LWW for scalars, OR-Set for arrays)
   - Sync via WebRTC or Matrix bridge

### AC4: Tier Migration

7. **Given** user with ephemeral tier  
   **When** they upgrade to persistent  
   **Then** current in-memory data is flushed to OPFS
   - New SQLite database created
   - All nodes persisted
   - Tier updated in session metadata

8. **Given** user with persistent tier  
   **When** they upgrade to synced  
   **Then** CRDT overlay is initialized
   - Yjs document created
   - Existing nodes loaded into CRDT
   - Sync code generated

### AC5: Quota Management

9. **Given** persistent/synced tier approaching quota  
   **When** user attempts large write  
   **Then** system checks available quota first
   - If sufficient: proceed
   - If insufficient: show quota warning + offer cleanup

---

## Technical Approach

### High-level Design

```
┌─────────────────────────────────────────────────────────────┐
│                      StorageManager                         │
├─────────────────────────────────────────────────────────────┤
│  + setTier(tier: StorageTier)                               │
│  + getTier(): StorageTier                                   │
│  + migrateTier(fromTier, toTier)                            │
│  + storeNode(node)                                          │
│  + queryNodes(...)                                          │
└─────────────────────────────────────────────────────────────┘
           │                     │                    │
           ▼                     ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ EphemeralAdapter│  │ PersistentAdapter│  │  SyncedAdapter  │
│  (in-memory)    │  │   (OPFS)         │  │ (OPFS + CRDT)   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Decision Matrix

| Tier       | Persistence | Survives Reload | Syncs Devices | Storage Backend | Use Case                  |
|------------|-------------|-----------------|---------------|-----------------|---------------------------|
| ephemeral  | Memory      | ❌              | ❌            | Map<string, Node> | Quick demos, privacy mode |
| persistent | OPFS        | ✅              | ❌            | SQLite (OPFS)   | Single-device guest       |
| synced     | OPFS + CRDT | ✅              | ✅            | SQLite + Yjs    | Multi-device guest/permanent |

### Components Involved

- **StorageManager**: Orchestrates tier adapters (apps/kernel)
- **EphemeralAdapter**: In-memory Map-based storage
- **PersistentAdapter**: SQLite + OPFS (packages/storage-sqlite)
- **SyncedAdapter**: PersistentAdapter + Yjs CRDT (packages/sync-crdt)
- **QuotaManager**: OPFS quota monitoring (packages/storage-sqlite)

### Key Decisions

- **ADR-006**: [Guest Mode and Collaborative Sessions](../ADRs/ADR-006-guest-mode-collaborative-sessions.md) - Storage tiers concept
- **ADR-009**: [OPFS Persistence Strategy](../ADRs/ADR-009-opfs-persistence-strategy.md) - OPFS structure
- **ADR-003**: [CRDT Synchronization](../ADRs/ADR-003-crdt-synchronization.md) - Yjs for synced tier

---

## API/Interface

```typescript
/**
 * Storage tier options
 */
export type StorageTier = 'ephemeral' | 'persistent' | 'synced';

/**
 * Storage adapter interface (implemented by each tier)
 */
export interface IStorageAdapter {
  /**
   * Initialize storage backend
   */
  initialize(): Promise<void>;
  
  /**
   * Store a JSON-LD node
   */
  storeNode(node: JsonLdNode): Promise<string>;
  
  /**
   * Query nodes by vault and filters
   */
  queryNodes(vaultId: string, filters?: QueryFilters): Promise<JsonLdNode[]>;
  
  /**
   * Get single node by ID
   */
  getNode(id: string): Promise<JsonLdNode | null>;
  
  /**
   * Delete node (soft delete)
   */
  deleteNode(id: string): Promise<void>;
  
  /**
   * Get storage stats
   */
  getStats(): Promise<StorageStats>;
  
  /**
   * Cleanup and shutdown
   */
  teardown(): Promise<void>;
}

/**
 * Storage stats for quota management
 */
export interface StorageStats {
  tier: StorageTier;
  nodeCount: number;
  bytesUsed: number;
  quotaAvailable: number;
  lastSyncAt?: string;  // Only for synced tier
}

/**
 * StorageManager - Tier orchestration
 */
export interface IStorageManager {
  /**
   * Get current storage tier
   */
  getTier(): StorageTier;
  
  /**
   * Set storage tier (initializes adapter)
   * @throws Error if tier not supported in browser
   */
  setTier(tier: StorageTier): Promise<void>;
  
  /**
   * Migrate from one tier to another
   * @param toTier - Target tier
   * @returns Promise resolving when migration complete
   */
  migrateTier(toTier: StorageTier): Promise<void>;
  
  /**
   * Unified storage operations (delegates to active adapter)
   */
  storeNode(node: JsonLdNode): Promise<string>;
  queryNodes(vaultId: string, filters?: QueryFilters): Promise<JsonLdNode[]>;
  getNode(id: string): Promise<JsonLdNode | null>;
  deleteNode(id: string): Promise<void>;
  
  /**
   * Get current storage statistics
   */
  getStats(): Promise<StorageStats>;
  
  /**
   * Check available quota (for persistent/synced tiers)
   */
  checkQuota(): Promise<QuotaStatus>;
}

export interface QuotaStatus {
  available: number;      // Bytes available
  used: number;           // Bytes used
  percentage: number;     // 0-100
  warning: boolean;       // True if >80%
}
```

---

## Test Coverage

### Integration Tests (BDD)

- [ ] Ephemeral tier: data lost on reload
- [ ] Persistent tier: data survives reload
- [ ] Synced tier: data syncs between two tabs
- [ ] Tier migration: ephemeral → persistent (data preserved)
- [ ] Tier migration: persistent → synced (CRDT initialized)
- [ ] Quota warning: shown when approaching limit
- [ ] Quota exceeded: write blocked with clear error

### Unit Tests (TDD)

- [ ] `setTier()` initializes correct adapter
- [ ] `getTier()` returns current tier
- [ ] `migrateTier()` copies data between adapters
- [ ] `checkQuota()` calculates percentage correctly
- [ ] `EphemeralAdapter` stores in-memory only
- [ ] `PersistentAdapter` writes to OPFS
- [ ] `SyncedAdapter` updates both SQLite and Yjs

---

## Implementation Tasks

### SDD (Current Phase)

- [x] Define StorageTier type
- [x] Define IStorageAdapter interface
- [x] Define IStorageManager interface
- [x] Document decision matrix
- [x] Link relevant ADRs

### BDD (Next Phase)

- [ ] Write integration test: ephemeral tier lifecycle
- [ ] Write integration test: persistent tier persistence
- [ ] Write integration test: synced tier sync behavior
- [ ] Write integration test: tier migration
- [ ] Write integration test: quota management

### TDD (Following Phase)

- [ ] Write unit tests for StorageManager
- [ ] Write unit tests for EphemeralAdapter
- [ ] Write unit tests for PersistentAdapter
- [ ] Write unit tests for SyncedAdapter
- [ ] Write unit tests for QuotaManager

### DDD (Implementation)

- [ ] Implement EphemeralAdapter (in-memory Map)
- [ ] Implement PersistentAdapter (SQLite + OPFS)
- [ ] Implement SyncedAdapter (extends PersistentAdapter + Yjs)
- [ ] Implement StorageManager (adapter orchestration)
- [ ] Implement QuotaManager (OPFS quota API)
- [ ] Implement tier migration logic

---

## Performance Considerations

### Ephemeral Tier

- **Pros**: Fastest (no I/O), zero disk footprint
- **Cons**: Limited by available RAM, data loss on reload
- **Target**: <1ms read/write latency

### Persistent Tier

- **Pros**: Balance of speed and reliability
- **Cons**: OPFS I/O overhead
- **Target**: <5ms read/write latency

### Synced Tier

- **Pros**: Multi-device capability, offline-first
- **Cons**: CRDT overhead, network latency
- **Target**: <10ms read/write latency (local), eventual consistency (remote)

---

## Quota Strategy

### OPFS Quota Detection

```typescript
async function checkQuota(): Promise<QuotaStatus> {
  const estimate = await navigator.storage.estimate();
  const used = estimate.usage || 0;
  const available = estimate.quota || 0;
  const percentage = (used / available) * 100;
  
  return {
    available,
    used,
    percentage,
    warning: percentage > 80
  };
}
```

### Quota Warning Thresholds

- **80%**: Show yellow warning ("Storage almost full")
- **90%**: Show orange warning + suggest cleanup
- **95%**: Block new writes + force cleanup dialog

### Cleanup Strategy

1. Delete oldest soft-deleted nodes (deleted_at IS NOT NULL)
2. Compact SQLite database (VACUUM)
3. Clear CRDT tombstones older than 30 days
4. Offer user export + fresh start

---

## Browser Compatibility

| Browser | Ephemeral | Persistent (OPFS) | Synced (OPFS + CRDT) |
|---------|-----------|-------------------|----------------------|
| Chrome 86+ | ✅ | ✅ | ✅ |
| Firefox 111+ | ✅ | ✅ | ✅ |
| Safari 15.2+ | ✅ | ✅ | ✅ |
| Edge 86+ | ✅ | ✅ | ✅ |
| Older browsers | ✅ | ❌ (fallback to ephemeral) | ❌ |

**Polyfill Strategy**: If OPFS not available, degrade gracefully to ephemeral tier + show warning.

---

## References

- [ADR-006: Guest Mode and Collaborative Sessions](../ADRs/ADR-006-guest-mode-collaborative-sessions.md)
- [ADR-009: OPFS Persistence Strategy](../ADRs/ADR-009-opfs-persistence-strategy.md)
- [ADR-003: CRDT Synchronization](../ADRs/ADR-003-crdt-synchronization.md)
- [ADR-015: SQLite Engine Decision](../ADRs/ADR-015-sqlite-engine-decision.md)
- [Feature: Session Management](session-management.md)
- [Feature: Guest to Permanent Migration](guest-to-permanent-migration.md)
