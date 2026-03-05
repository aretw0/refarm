# Identity (Nostr) - Roadmap

**Current Version**: v0.0.1-dev  
**Parent**: [Main Roadmap](../../roadmaps/MAIN.md)  
**Process**: SDD → BDD → TDD → DDD ([Workflow Guide](../../docs/WORKFLOW.md))

---

## Overview

**identity-nostr** provides sovereign identity via Nostr protocol:

- **Nostr NIPs** (protocol standards)
- **Keypair management** (nsec/npub)
- **Event signing** (cryptographic identity)
- **Relay communication** (publish/subscribe)

**Responsibilities**:

- Generate and manage keypairs
- Sign and verify Nostr events
- Connect to Nostr relays
- Publish/subscribe to events
- Profile management (NIP-01, NIP-05)
- Relay list management (NIP-65)

---

## v0.1.0 - Foundation (Skip - Storage Focus)
**Status**: Deferred  
**Reason**: v0.1.0 focuses on storage, sync, kernel (no identity needed yet)

Identity development begins in v0.2.0.

---

## v0.2.0 - Core Identity
**Scope**: Nostr keypair + basic relay communication  
**Depends on**: kernel v0.2.0 (event bus), storage v0.1.0 (keypair storage)

### Pre-SDD Research

- [ ] Test: nostr-tools library (keypair, signing, relays)
- [ ] Test: Secure keypair storage (encrypted in SQLite)
- [ ] Test: Relay connection stability (reconnection)
- [ ] Validate: NIP-01 (basic protocol) implementation

### SDD (Spec Driven)

**Goal**: Define identity service and Nostr integration  
**Gate**: Specs complete, peer reviewed, no TODOs

- [ ] ADR-013: Nostr as identity layer (rationale)
- [ ] Spec: IdentityService interface
  - [ ] Generate keypair (nsec/npub)
  - [ ] Import keypair (nsec string)
  - [ ] Export keypair (encrypted backup)
  - [ ] Sign event (NIP-01)
  - [ ] Verify signature
- [ ] Spec: Relay connection
  - [ ] Connect to relay (WebSocket)
  - [ ] Subscribe to events (REQ)
  - [ ] Publish event (EVENT)
  - [ ] Close subscription (CLOSE)
  - [ ] Handle relay responses (OK, EOSE, NOTICE)
- [ ] Spec: Secure keypair storage
  - [ ] Encrypt nsec with user password (or biometric)
  - [ ] Store in SQLite
  - [ ] Unlock on session start

### BDD (Behaviour Driven)

**Goal**: Write integration tests that describe expected behavior (FAILING)  
**Gate**: Tests written (🔴 RED), peer reviewed

- [ ] E2E: User generates new keypair, stored encrypted
- [ ] E2E: User imports existing nsec, identity restored
- [ ] E2E: User signs event, signature valid
- [ ] E2E: Connect to relay, subscription works
- [ ] E2E: Publish event, relay confirms (OK)
- [ ] E2E: Receive event from relay (subscription)
- [ ] E2E: Keypair persists across restarts (encrypted)
- [ ] Acceptance: Identity is sovereign, cryptographic, persistent

### TDD (Test Driven)

**Goal**: Write unit tests for contracts (FAILING)  
**Gate**: Tests written (🔴 RED), coverage ≥80%

- [ ] Unit: Keypair generation (valid nsec/npub)
- [ ] Unit: Event signing (NIP-01 format)
- [ ] Unit: Signature verification
- [ ] Unit: Relay message parsing
- [ ] Unit: Encryption/decryption (keypair storage)
- [ ] Coverage: >80%

### DDD (Domain Implementation)

**Goal**: Implement code until all tests PASS  
**Gate**: Tests GREEN (🟢), coverage met, changeset created

- [ ] Domain: IdentityService class
- [ ] Domain: Keypair lifecycle (generate, import, export)
- [ ] Domain: Event signing/verification
- [ ] Domain: Relay connection manager
- [ ] Domain: Subscription manager
- [ ] Infra: nostr-tools integration
- [ ] Infra: WebSocket relay client
- [ ] Infra: Encryption (Web Crypto API)

### CHANGELOG

```
## [0.2.0] - YYYY-MM-DD
### Added
- Core IdentityService with Nostr keypair
- Event signing and verification (NIP-01)
- Relay connection (WebSocket)
- Publish/subscribe events
- Secure keypair storage (encrypted)
```

---

## v0.3.0 - Profile Management
**Scope**: User profile (NIP-01) + verification (NIP-05)  
**Depends on**: v0.2.0 (identity core)

### SDD (Spec Driven)

- [ ] Spec: Profile management (NIP-01 kind:0)
  - [ ] Set profile (name, about, picture, banner)
  - [ ] Fetch profile from relays
  - [ ] Update profile
- [ ] Spec: NIP-05 verification
  - [ ] Verify <user@domain.com> (DNS-based)
  - [ ] Display verification badge

### BDD (Behaviour Driven)

- [ ] E2E: User sets profile, published to relays
- [ ] E2E: User fetches own profile, displayed
- [ ] E2E: User verifies NIP-05, badge shown
- [ ] Acceptance: User has recognizable identity

### TDD (Test Driven)

- [ ] Unit: Profile event creation (kind:0)
- [ ] Unit: NIP-05 verification logic
- [ ] Unit: Profile parsing
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: Profile manager
- [ ] Domain: NIP-05 verifier
- [ ] Infra: HTTP fetch (for NIP-05 .well-known)
- [ ] Docs: Profile setup guide

### CHANGELOG

```
## [0.3.0] - YYYY-MM-DD
### Added
- User profile management (NIP-01 kind:0)
- NIP-05 verification (user@domain)
- Profile fetching from relays
```

---

## v0.4.0 - Relay List Management
**Scope**: NIP-65 relay lists (read/write relays)  
**Depends on**: v0.3.0 (profile stable)

### SDD (Spec Driven)

- [ ] Spec: Relay list management (NIP-65 kind:10002)
  - [ ] Add relay (read/write)
  - [ ] Remove relay
  - [ ] Publish relay list
  - [ ] Fetch relay list from network
- [ ] Spec: Relay scoring
  - [ ] Track relay reliability (uptime, latency)
  - [ ] Prefer reliable relays

### BDD (Behaviour Driven)

- [ ] E2E: User adds relay, published to network
- [ ] E2E: User removes relay, list updated
- [ ] E2E: Fetch relay list from another user
- [ ] E2E: Relay scoring prioritizes fast relays
- [ ] Acceptance: User controls relay connections

### TDD (Test Driven)

- [ ] Unit: Relay list event creation (kind:10002)
- [ ] Unit: Relay scoring logic
- [ ] Unit: Relay list parsing
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: Relay list manager
- [ ] Domain: Relay scorer
- [ ] Docs: Relay selection guide

### CHANGELOG

```
## [0.4.0] - YYYY-MM-DD
### Added
- Relay list management (NIP-65)
- Relay scoring and prioritization
- Read/write relay distinction
```

---

## v0.5.0 - Advanced NIPs
**Scope**: Extended Nostr features (NIP-04, NIP-51, etc.)  
**Depends on**: v0.4.0 (relay lists stable)

### SDD (Spec Driven)

- [ ] Spec: NIP-04 encrypted DMs
  - [ ] Encrypt message (shared secret)
  - [ ] Decrypt message
  - [ ] Publish DM event (kind:4)
- [ ] Spec: NIP-51 lists (bookmarks, pins, mute)
  - [ ] Create list (kind:30000-30003)
  - [ ] Manage list items
  - [ ] Publish list

### BDD (Behaviour Driven)

- [ ] E2E: User sends encrypted DM
- [ ] E2E: User receives and decrypts DM
- [ ] E2E: User creates bookmark list
- [ ] Acceptance: Advanced Nostr features work

### TDD (Test Driven)

- [ ] Unit: NIP-04 encryption/decryption
- [ ] Unit: NIP-51 list creation
- [ ] Coverage: >80%

### DDD (Domain Implementation)

- [ ] Domain: DM manager (NIP-04)
- [ ] Domain: List manager (NIP-51)
- [ ] Infra: Shared secret derivation (ECDH)

### CHANGELOG

```
## [0.5.0] - YYYY-MM-DD
### Added
- Encrypted direct messages (NIP-04)
- Lists support (NIP-51: bookmarks, pins, mute)
```

---

## v1.0.0 - Production Ready
**Scope**: Reliability, security, NIP coverage  
**Depends on**: All features stable

### Quality Criteria

- [ ] Relay connection stable (auto-reconnect)
- [ ] Event signing <10ms
- [ ] Keypair encrypted (secure storage)
- [ ] NIP-01, NIP-05, NIP-65 fully implemented
- [ ] Optional: NIP-04, NIP-51 implemented
- [ ] No private key leakage (security audit)

### SDD (Spec Driven)

- [ ] Spec: Security hardening
  - [ ] Private key never exposed (memory protection)
  - [ ] Rate limiting (avoid relay spam)
  - [ ] Event validation (schema checks)
- [ ] Spec: Monitoring
  - [ ] Relay connection metrics
  - [ ] Event publish success rate
  - [ ] Signature performance

### BDD (Behaviour Driven)

- [ ] E2E: Relay disconnect/reconnect, no data loss
- [ ] E2E: Security audit passes (no key leakage)
- [ ] E2E: All NIPs work under load
- [ ] Acceptance: Identity is production-grade

### TDD (Test Driven)

- [ ] Unit: Rate limiting logic
- [ ] Unit: Event validation
- [ ] Benchmark: All quality criteria met
- [ ] Security test: Key leakage checks
- [ ] Coverage: >85%

### DDD (Domain Implementation)

- [ ] Polish: Security hardening
- [ ] Polish: Performance tuning
- [ ] Polish: Observability integration
- [ ] Docs: API reference complete
- [ ] Docs: Security best practices
- [ ] Docs: NIP implementation status

### CHANGELOG

```
## [1.0.0] - YYYY-MM-DD
### Changed
- Security hardening (key protection, rate limiting)
- Enhanced relay reliability
- Improved observability integration

### Fixed
- [All known identity issues addressed]
```

---

## Notes

- **Library**: nostr-tools is the standard (TypeScript, actively maintained)
- **Security**: Private key (nsec) MUST be encrypted at rest
- **Relays**: Support multiple relays (redundancy, censorship resistance)
- **NIPs**: Prioritize NIP-01 (core), NIP-05 (verification), NIP-65 (relay lists)
- **Testing**: Focus on security (key leakage, replay attacks)
- **Performance**: Target <10ms for event signing
- **Future NIPs**: NIP-04 (DMs), NIP-51 (lists), NIP-57 (zaps), NIP-42 (auth)
