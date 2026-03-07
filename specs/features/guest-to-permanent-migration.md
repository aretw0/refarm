# Feature: Guest to Permanent Migration

**Status**: Draft  
**Version**: v0.1.0  
**Owner**: Core Team

---

## Summary

Guest to Permanent Migration enables users who started as anonymous guests to upgrade to permanent accounts with Nostr identity. This migration preserves all existing data while changing ownership attribution, supporting Refarm's progressive identity model where users can defer commitment until they're ready.

---

## User Stories

### Story 1: Progressive Commitment

**As a** guest user who's been using Refarm for a while  
**I want** to upgrade to a permanent account without losing my data  
**So that** I can preserve my work and sync across devices

### Story 2: Data Ownership Transfer

**As a** guest user upgrading to permanent  
**I want** my existing data to be re-attributed to my Nostr identity  
**So that** I maintain consistent ownership across all my nodes

### Story 3: Zero Downtime Migration

**As a** guest user in the middle of work  
**I want** the upgrade process to be instant and non-disruptive  
**So that** I can continue working without interruption

### Story 4: Rollback Safety

**As a** user whose upgrade failed  
**I want** the system to rollback gracefully  
**So that** I don't lose data if something goes wrong

---

## Acceptance Criteria

### AC1: Migration Trigger

1. **Given** an active guest session  
   **When** user clicks "Upgrade to Permanent"  
   **Then** migration flow initiates
   - Show Nostr key input dialog
   - Explain what will happen (data preserved, ownership changed)
   - Offer "Generate new key" or "Import existing key"

### AC2: Identity Creation/Import

2. **Given** user chooses "Generate new key"  
   **When** they confirm generation  
   **Then** new Nostr keypair is created
   - Private key (nsec) generated securely
   - Public key (npub) derived
   - Keys stored in packages/identity-nostr
   - Backup prompt shown (download nsec)

3. **Given** user chooses "Import existing key"  
   **When** they paste valid nsec or hex key  
   **Then** identity is imported
   - Key validated (Nostr format check)
   - Public key derived
   - Keys stored in packages/identity-nostr

### AC3: Data Ownership Rewrite

4. **Given** valid Nostr identity established  
   **When** migration proceeds  
   **Then** all nodes are updated atomically
   - SQLite transaction BEGIN
   - UPDATE nodes SET vault_id = {new_pubkey} WHERE vault_id = {old_uuid}
   - UPDATE vault metadata in OPFS
   - COMMIT transaction
   - Session updated (type: 'permanent', vaultId: pubkey)

5. **Given** ownership rewrite in progress  
   **When** 100k nodes need updating  
   **Then** migration completes in <5 seconds
   - Single UPDATE statement (no loops)
   - Indexed on vault_id for speed
   - Progress indicator shown to user

### AC4: Storage Preservation

6. **Given** guest had persistent or synced tier  
   **When** migration completes  
   **Then** storage tier remains unchanged
   - No data migration between storage backends
   - Same SQLite database file
   - Same OPFS vault directory
   - Only metadata updated

### AC5: CRDT State Transfer

7. **Given** guest had synced tier  
   **When** migration completes  
   **Then** CRDT document ownership updates
   - Yjs document metadata updated
   - Sync code regenerated (now bound to Nostr pubkey)
   - Peers automatically recognize new identity

### AC6: Session Continuity

8. **Given** migration successful  
   **When** user continues working  
   **Then** session context is preserved
   - No reload required
   - UI state maintained
   - Active documents remain open
   - Previous work continues seamlessly

### AC7: Rollback on Failure

9. **Given** migration fails (e.g., OPFS error, quota exceeded)  
   **When** error is caught  
   **Then** system rolls back to guest state
   - SQLite transaction ROLLBACK
   - Identity keys discarded
   - Session remains guest
   - User sees clear error message with retry option

---

## Technical Approach

### High-level Design

```
┌─────────────────────────────────────────────────────────────┐
│                  Migration Orchestrator                      │
├─────────────────────────────────────────────────────────────┤
│  1. Validate Nostr identity                                  │
│  2. Begin SQLite transaction                                 │
│  3. Rewrite node ownership (UPDATE)                          │
│  4. Update vault metadata (OPFS)                             │
│  5. Update CRDT state (if synced)                            │
│  6. Persist identity (identity-nostr)                        │
│  7. Update session (SessionManager)                          │
│  8. Commit or Rollback                                       │
└─────────────────────────────────────────────────────────────┘
```

### Migration Sequence Diagram

```
User          UI           SessionManager   StorageManager   IdentityManager
 │             │                 │                │                │
 ├─Click───────▶                 │                │                │
 │  "Upgrade"  │                 │                │                │
 │             ├─Generate────────┤                │                │
 │             │   Key           │                │                │
 │             │                 │                ├─Store Keys────▶│
 │             │                 │                │                │
 │             │                 ├─BEGIN TRANSACTION─────────────▶│
 │             │                 │                │                │
 │             │                 ├─UPDATE nodes (vault_id)───────▶│
 │             │                 │                │                │
 │             │                 ├─UPDATE vault metadata─────────▶│
 │             │                 │                │                │
 │             │                 ├─COMMIT TRANSACTION────────────▶│
 │             │                 │                │                │
 │             │                 ├─Update Session─┤                │
 │             │   (type: permanent, vaultId: pubkey)             │
 │             │                 │                │                │
 │◀────────────┴─Success─────────┴────────────────┴────────────────┤
 │  No reload, continue working                                    │
```

### Components Involved

- **SessionManager**: Orchestrates migration flow (apps/kernel)
- **IdentityManager**: Generates/imports Nostr keys (packages/identity-nostr)
- **StorageManager**: Executes ownership rewrite (packages/storage-sqlite)
- **SyncEngine**: Updates CRDT metadata if synced tier (packages/sync-crdt)

### Key Decisions

- **ADR-006**: [Guest Mode and Collaborative Sessions](../ADRs/ADR-006-guest-mode-collaborative-sessions.md) - Migration rationale
- **ADR-009**: [OPFS Persistence Strategy](../ADRs/ADR-009-opfs-persistence-strategy.md) - Vault metadata structure
- **ADR-003**: [CRDT Synchronization](../ADRs/ADR-003-crdt-synchronization.md) - Ownership in sync layer

---

## API/Interface

```typescript
/**
 * Migration options
 */
export interface MigrationOptions {
  nostrKey?: string;              // Optional: import existing key (nsec or hex)
  generateNew?: boolean;          // If true, generate new keypair
  backupPrompt?: boolean;         // Show backup reminder (default: true)
}

/**
 * Migration result
 */
export interface MigrationResult {
  success: boolean;
  newVaultId: string;             // Nostr pubkey (npub format)
  nodesUpdated: number;           // Count of nodes re-attributed
  durationMs: number;             // Migration time
  error?: Error;                  // If success=false
}

/**
 * Migration progress callback
 */
export type MigrationProgressCallback = (progress: {
  stage: 'validating' | 'rewriting' | 'updating_metadata' | 'finalizing';
  percentage: number;             // 0-100
  message: string;
}) => void;

/**
 * IMigrationService - Migration orchestration
 */
export interface IMigrationService {
  /**
   * Migrate guest session to permanent
   * @param options - Migration configuration
   * @param onProgress - Optional progress callback
   * @returns Promise resolving to migration result
   * @throws Error if session not guest or migration fails
   */
  migrateToPermament(
    options: MigrationOptions,
    onProgress?: MigrationProgressCallback
  ): Promise<MigrationResult>;
  
  /**
   * Validate Nostr key format
   * @param key - nsec, npub, or hex key
   * @returns true if valid, false otherwise
   */
  validateNostrKey(key: string): boolean;
  
  /**
   * Estimate migration duration
   * @param nodeCount - Number of nodes to migrate
   * @returns Estimated milliseconds
   */
  estimateDuration(nodeCount: number): Promise<number>;
  
  /**
   * Check if migration is possible
   * @returns Validation result with reasons if not possible
   */
  canMigrate(): Promise<{ possible: boolean; reasons?: string[] }>;
}
```

---

## Test Coverage

### Integration Tests (BDD)

- [ ] Guest generates new key → migration succeeds
- [ ] Guest imports existing key → migration succeeds
- [ ] Guest with 100k nodes → migration <5s
- [ ] Migration preserves ephemeral tier (memory)
- [ ] Migration preserves persistent tier (OPFS)
- [ ] Migration preserves synced tier (OPFS + CRDT)
- [ ] Migration failure → rollback to guest state
- [ ] After migration → user can continue working without reload

### Unit Tests (TDD)

- [ ] `validateNostrKey()` accepts valid nsec/npub/hex
- [ ] `validateNostrKey()` rejects invalid formats
- [ ] `estimateDuration()` scales linearly with node count
- [ ] `canMigrate()` returns false if session not guest
- [ ] `migrateToPermament()` calls all steps in sequence
- [ ] `migrateToPermament()` rolls back on SQLite error
- [ ] Progress callback fires for each stage

---

## Implementation Tasks

### SDD (Current Phase)

- [x] Define MigrationOptions interface
- [x] Define IMigrationService interface
- [x] Document migration sequence
- [x] Link relevant ADRs

### BDD (Next Phase)

- [ ] Write integration test: full migration flow
- [ ] Write integration test: migration with 100k nodes
- [ ] Write integration test: rollback on failure
- [ ] Write integration test: CRDT state transfer

### TDD (Following Phase)

- [ ] Write unit tests for IMigrationService methods
- [ ] Write unit tests for key validation
- [ ] Write unit tests for transaction rollback

### DDD (Implementation)

- [ ] Implement MigrationService class
- [ ] Implement Nostr key validation (NIP-19)
- [ ] Implement ownership rewrite SQL
- [ ] Implement vault metadata update
- [ ] Implement CRDT metadata update
- [ ] Implement rollback logic
- [ ] Integrate with SessionManager

---

## Security Considerations

### SC1: Key Generation Entropy

**Requirement**: Use cryptographically secure random number generator  
**Implementation**: `crypto.getRandomValues()` (Web Crypto API)

### SC2: Private Key Storage

**Requirement**: Store nsec encrypted in localStorage/IndexedDB  
**Implementation**: Use browser's built-in encryption or Web Crypto SubtleCrypto

### SC3: Backup Reminder

**Requirement**: Force user to acknowledge backup before proceeding  
**Implementation**: Modal with "I have backed up my key" checkbox

### SC4: Key Validation

**Requirement**: Validate imported keys before using  
**Implementation**: NIP-19 format check + signature test

---

## Performance Benchmarks

### Target Metrics

| Node Count | Migration Time | Acceptable |
|------------|---------------|------------|
| 100        | <50ms         | ✅         |
| 1,000      | <200ms        | ✅         |
| 10,000     | <1s           | ✅         |
| 100,000    | <5s           | ✅         |
| 1,000,000  | <30s          | ⚠️ (edge case) |

### Optimization Strategy

```sql
-- Single UPDATE statement (fast)
UPDATE nodes 
SET vault_id = :new_pubkey 
WHERE vault_id = :old_uuid;

-- Indexed on vault_id for O(1) lookup
CREATE INDEX idx_nodes_vault ON nodes(vault_id);
```

**Key insight**: SQLite can update millions of rows per second with proper indexing.

---

## Error Scenarios

### ES1: Invalid Nostr Key

**Given** user imports invalid key  
**When** validation runs  
**Then** show error "Invalid Nostr key format (expected nsec or hex)"

### ES2: Quota Exceeded During Migration

**Given** OPFS quota full  
**When** metadata update attempted  
**Then** rollback transaction + show "Storage full, free up space and retry"

### ES3: CRDT Sync Failure

**Given** synced tier active  
**When** CRDT metadata update fails  
**Then** rollback transaction + show "Sync error, check network and retry"

### ES4: Session Already Permanent

**Given** session is already permanent  
**When** migration attempted  
**Then** throw error "Session is already permanent"

---

## UI/UX Considerations

### Upgrade Button Placement

- **Location**: User profile dropdown / Settings page
- **Label**: "Upgrade to Permanent Account"
- **Icon**: Key icon (🔑)
- **Disabled**: If session already permanent

### Migration Dialog

```
┌──────────────────────────────────────────────────┐
│ Upgrade to Permanent Account                      │
├──────────────────────────────────────────────────┤
│ Your data will be preserved. Choose how to        │
│ create your permanent identity:                   │
│                                                   │
│ ○ Generate new Nostr key (recommended)            │
│ ○ Import existing Nostr key                       │
│                                                   │
│ [ ] I understand my data will be re-attributed   │
│                                                   │
│ [Cancel]                          [Continue] ──▶  │
└──────────────────────────────────────────────────┘
```

### Progress Indicator

```
┌──────────────────────────────────────────────────┐
│ Migrating to Permanent...                         │
├──────────────────────────────────────────────────┤
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░ 80%                         │
│                                                   │
│ Updating ownership (80,234 / 100,000 nodes)      │
└──────────────────────────────────────────────────┘
```

---

## References

- [ADR-006: Guest Mode and Collaborative Sessions](../ADRs/ADR-006-guest-mode-collaborative-sessions.md)
- [ADR-009: OPFS Persistence Strategy](../ADRs/ADR-009-opfs-persistence-strategy.md)
- [ADR-003: CRDT Synchronization](../ADRs/ADR-003-crdt-synchronization.md)
- [Feature: Session Management](session-management.md)
- [Feature: Storage Tiers](storage-tiers.md)
- [NIP-19: bech32-encoded entities](https://github.com/nostr-protocol/nips/blob/master/19.md)
