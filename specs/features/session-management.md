# Feature: Session Management

**Status**: Draft  
**Version**: v0.1.0  
**Owner**: Core Team

---

## Summary

Session Management provides the lifecycle handling for user sessions in Refarm, supporting both guest (anonymous) and permanent (Nostr-identified) users. It manages session creation, storage tier selection, persistence, and upgrade paths, enabling the identity-orthogonal architecture where users can choose when (or if) to commit to a permanent identity.

---

## User Stories

### Story 1: Guest Session

**As a** first-time visitor  
**I want** to start using Refarm immediately without creating an account  
**So that** I can try the platform with zero friction

### Story 2: Storage Tier Choice

**As a** guest user  
**I want** to choose how my data persists (ephemeral/persistent/synced)  
**So that** I control privacy vs. convenience trade-offs

### Story 3: Upgrade to Permanent

**As a** guest user who likes the platform  
**I want** to upgrade to a permanent account with Nostr identity  
**So that** I can own my data long-term and sync across devices

### Story 4: Session Recovery

**As a** returning user  
**I want** the system to restore my previous session automatically  
**So that** I don't lose my work between visits

---

## Acceptance Criteria

### AC1: Guest Session Creation

1. **Given** a new visitor lands on Refarm  
   **When** they click "Start as Guest"  
   **Then** a guest session is created with a unique UUID vaultId
   - Session stored in localStorage
   - Default tier: `ephemeral`
   - No Nostr identity required

### AC2: Storage Tier Selection

2. **Given** a guest session is being created  
   **When** user selects a storage tier (ephemeral/persistent/synced)  
   **Then** session is configured with chosen tier
   - Ephemeral: data in memory only
   - Persistent: data in OPFS (survives reload)
   - Synced: data in OPFS + CRDT (multi-device)

### AC3: Session Persistence

3. **Given** a guest session with persistent tier  
   **When** user closes browser and returns  
   **Then** session is restored from localStorage
   - VaultId matches previous session
   - Data loads from OPFS
   - State continues from last visit

### AC4: Upgrade to Permanent

4. **Given** an active guest session  
   **When** user clicks "Upgrade to Permanent" and provides Nostr key  
   **Then** session upgrades to permanent
   - VaultId changes from UUID → Nostr pubkey
   - All nodes updated with new ownership
   - Identity persisted in identity-nostr package
   - OPFS data remains (no migration needed)

### AC5: Session Destruction

5. **Given** a guest or permanent session  
   **When** user clicks "Delete All Data"  
   **Then** session is destroyed
   - localStorage cleared
   - OPFS cleared (if persistent tier)
   - User redirected to fresh start

---

## Technical Approach

### High-level Design

```
┌─────────────────────────────────────────────────────────┐
│                    SessionManager                        │
├─────────────────────────────────────────────────────────┤
│ + createGuestSession(tier)                              │
│ + loadSession()                                          │
│ + upgradeToPermament(nostrKey)                          │
│ + getCurrentSession()                                    │
│ + destroySession()                                       │
└─────────────────────────────────────────────────────────┘
           │                            │
           ▼                            ▼
┌──────────────────┐         ┌──────────────────┐
│  localStorage    │         │  identity-nostr  │
│  (session state) │         │  (Nostr keys)    │
└──────────────────┘         └──────────────────┘
```

### Session State Machine

```
┌───────────┐
│ NO_SESSION│
└─────┬─────┘
      │ createGuestSession()
      ▼
┌───────────┐
│   GUEST   │
└─────┬─────┘
      │ upgradeToPermament()
      ▼
┌───────────┐
│ PERMANENT │
└───────────┘

All states → destroySession() → NO_SESSION
```

### Components Involved

- **SessionManager**: Core session lifecycle (apps/kernel)
- **StorageManager**: Tier-specific persistence (packages/storage-sqlite)
- **IdentityManager**: Nostr keypair handling (packages/identity-nostr)
- **SyncEngine**: Multi-device sync (packages/sync-crdt)

### Key Decisions

- **ADR-006**: [Guest Mode and Collaborative Sessions](../ADRs/ADR-006-guest-mode-collaborative-sessions.md) - Identity-orthogonal storage
- **ADR-009**: [OPFS Persistence Strategy](../ADRs/ADR-009-opfs-persistence-strategy.md) - Vault directory structure
- **ADR-002**: [Offline-First Architecture](../ADRs/ADR-002-offline-first-architecture.md) - localStorage + OPFS strategy

---

## API/Interface

```typescript
/**
 * Session state types
 */
export type SessionType = 'guest' | 'permanent';
export type StorageTier = 'ephemeral' | 'persistent' | 'synced';

export interface Session {
  id: string;                    // Session UUID
  type: SessionType;              // Guest or permanent
  vaultId: string;                // UUID (guest) or Nostr pubkey (permanent)
  tier: StorageTier;              // Storage persistence level
  createdAt: string;              // ISO timestamp
  lastAccessAt: string;           // ISO timestamp
  owner?: string;                 // Nostr pubkey (if permanent)
}

/**
 * SessionManager - Core session lifecycle
 */
export interface ISessionManager {
  /**
   * Create new guest session
   * @param tier - Storage persistence level
   * @returns Promise resolving to new session
   */
  createGuestSession(tier: StorageTier): Promise<Session>;
  
  /**
   * Load existing session from localStorage
   * @returns Session if found, null otherwise
   */
  loadSession(): Promise<Session | null>;
  
  /**
   * Upgrade guest session to permanent with Nostr identity
   * @param nostrKey - Nostr private key (nsec) or public key (npub)
   * @throws Error if session is already permanent or key invalid
   */
  upgradeToPermament(nostrKey: string): Promise<void>;
  
  /**
   * Get current active session
   * @returns Current session or null if none
   */
  getCurrentSession(): Session | null;
  
  /**
   * Destroy current session and clear all data
   * Warning: This is destructive and cannot be undone
   */
  destroySession(): Promise<void>;
  
  /**
   * Update session last access timestamp
   */
  updateLastAccess(): Promise<void>;
}

/**
 * Session events for UI reactivity
 */
export interface SessionEvents {
  'session:created': (session: Session) => void;
  'session:loaded': (session: Session) => void;
  'session:upgraded': (session: Session) => void;
  'session:destroyed': () => void;
}
```

---

## Test Coverage

### Integration Tests (BDD)

- [ ] Guest creates ephemeral session → data in memory only
- [ ] Guest creates persistent session → data survives reload
- [ ] Guest creates synced session → CRDT initialized
- [ ] Guest upgrades to permanent → vaultId changes, data persists
- [ ] Returning user loads previous session → state restored
- [ ] User destroys session → localStorage + OPFS cleared

### Unit Tests (TDD)

- [ ] `createGuestSession()` generates valid UUID vaultId
- [ ] `createGuestSession()` respects tier parameter
- [ ] `loadSession()` returns null when no session exists
- [ ] `loadSession()` parses localStorage correctly
- [ ] `upgradeToPermament()` validates Nostr key format
- [ ] `upgradeToPermament()` throws if already permanent
- [ ] `getCurrentSession()` returns cached session
- [ ] `destroySession()` clears all traces

---

## Implementation Tasks

### SDD (Current Phase)

- [x] Define Session interface
- [x] Define ISessionManager interface
- [x] Document state machine
- [x] Link relevant ADRs

### BDD (Next Phase)

- [ ] Write integration test: guest session creation
- [ ] Write integration test: session persistence
- [ ] Write integration test: session upgrade
- [ ] Write integration test: session destruction

### TDD (Following Phase)

- [ ] Write unit tests for all ISessionManager methods
- [ ] Write unit tests for session validation
- [ ] Write unit tests for error cases

### DDD (Implementation)

- [ ] Implement SessionManager class
- [ ] Implement localStorage adapter
- [ ] Implement session serialization/deserialization
- [ ] Implement event emitter for session changes
- [ ] Integrate with StorageManager
- [ ] Integrate with IdentityManager

---

## Error Scenarios

### ES1: Quota Exceeded

**Given** guest selects persistent tier  
**When** localStorage or OPFS quota is full  
**Then** gracefully degrade to ephemeral tier + show warning

### ES2: Corrupted Session

**Given** session exists in localStorage  
**When** session JSON is malformed  
**Then** discard corrupted session + create fresh guest session

### ES3: Invalid Nostr Key

**Given** guest attempts to upgrade  
**When** provided Nostr key is invalid format  
**Then** throw validation error with clear message

### ES4: OPFS Not Available

**Given** browser doesn't support OPFS  
**When** user selects persistent/synced tier  
**Then** fallback to ephemeral + show compatibility warning

---

## References

- [ADR-006: Guest Mode and Collaborative Sessions](../ADRs/ADR-006-guest-mode-collaborative-sessions.md)
- [ADR-009: OPFS Persistence Strategy](../ADRs/ADR-009-opfs-persistence-strategy.md)
- [ADR-002: Offline-First Architecture](../ADRs/ADR-002-offline-first-architecture.md)
- [Feature: Storage Tiers](storage-tiers.md)
- [Feature: Guest to Permanent Migration](guest-to-permanent-migration.md)
