# Feature: session-contract-v1 — Conversation Threads

**Status**: In Progress (TDD baseline complete)
**Version**: v0.2.0
**Owner**: Arthur Silva

---

## Summary

Graduates `Session` and `SessionEntry` out of pi-agent's private namespace
(`urn:pi-agent:*`) into a formal platform capability contract. `session-contract-v1`
is the base contract for conversation threads — agnostic of LLM branching semantics —
consumable by LLM agents, messaging integrations (Telegram, Signal), and A2A
coordination (ADR-052). Pi-agent extends the base with LLM-specific fields without
coupling the contract: since CRDT nodes are schema-free (Extensibility Axiom A5),
base consumers safely ignore the extra fields.

---

## User Stories

**As a** pi-agent  
**I want** to read and write `Session`/`SessionEntry` nodes via a stable contract  
**So that** my internal schema can evolve without breaking farmhand or messaging
integrations that also consume sessions

**As a** messaging integration (Telegram/Signal bot)  
**I want** to create `Session` nodes that share the same schema as pi-agent sessions  
**So that** Homestead can show a unified conversation history regardless of origin

**As a** farmhand automation  
**I want** to read session entries to give agents context about past work  
**So that** I don't have to depend on pi-agent's private CRDT namespace

**As a** third-party plugin author  
**I want** `session-contract-v1` to define a stable, adapter-based interface  
**So that** I can build a session backend for any platform without modifying Refarm internals

---

## Acceptance Criteria

1. **Given** `session-contract-v1` is installed as a dependency  
   **When** a third party implements `SessionContractAdapter`  
   **Then** running `runSessionV1Conformance(adapter)` reports all 3 required tests passing

2. **Given** pi-agent starts a new conversation  
   **When** it calls `sessionAdapter.create()`  
   **Then** a `Session` node with `urn:refarm:session:v1:{id}` is written to the CRDT graph

3. **Given** a `Session` exists  
   **When** pi-agent appends a user message via `sessionAdapter.appendEntry()`  
   **Then** a `SessionEntry` node is written with the correct `parent_entry_id` chain  
   and the entry survives a session restart

4. **Given** pi-agent stores LLM-specific fields (`leaf_entry_id`, `name`) alongside
   the base contract fields  
   **When** a base-contract consumer reads the same `Session` node  
   **Then** it receives only the base fields and does not error on the extra CRDT fields

5. **Given** the namespace migration script runs  
   **When** it processes an existing `urn:pi-agent:session-{id}` node  
   **Then** the node is rewritten to `urn:refarm:session:v1:{id}` and old references
   are updated

6. **Given** a `SessionContractAdapter` with `entries` implemented  
   **When** `entries(sessionId, limit)` is called  
   **Then** entries are returned in chronological order and the `limit` is respected

---

## Technical Approach

**Namespace graduation:**

```
Before (pi-agent private):
  urn:pi-agent:session-{id}    →  After: urn:refarm:session:v1:{id}
  urn:pi-agent:entry-{id}      →  After: urn:refarm:session-entry:v1:{id}
```

**Pi-agent extension model (no coupling):**

```
// session-contract-v1 base (platform)
Session:      @id, participants, context_id, created_at_ns
SessionEntry: @id, session_id, parent_entry_id, kind, content, timestamp_ns

// pi-agent extension (plugin-local, extra CRDT fields — ignored by base consumers)
Session + { name, leaf_entry_id, parent_session_id }
```

**Package layout:**

```
packages/
  session-contract-v1/      ← contract types + conformance runner

consumers (implement the adapter):
  apps/pi-agent/            ← uses sessionAdapter + stores extra fields alongside
  packages/storage-sqlite/  ← future: SessionContractAdapter backed by Loro CRDT
  apps/me/ (Homestead)      ← reads Session/SessionEntry for conversation history
  integrations/telegram/    ← messaging adapter that creates Session per chat
```

**Key decisions:**

- The base contract covers the minimum required by any thread consumer: create, get,
  update, appendEntry. LLM-specific features (branching, leaf tracking, naming) are
  pi-agent's concern, not the contract's.
- `SessionEntry` is append-only (no update/delete) and linked via `parent_entry_id`
  for branch-safe history walks — a linked list that works correctly under CRDT
  concurrent appends.
- `participants[]` is a string array of URNs (agents, users, bots) — the contract
  is multi-party by default.
- The namespace migration is a one-time script, safe pre-v0.1.0 while the dataset
  is personal and small.
- Publication deferred to v0.2.0: requires pi-agent migration + daily-driver
  validation before ecosystem exposure.

---

## API/Interface

```typescript
// packages/session-contract-v1/src/types.ts

export const SESSION_CAPABILITY = "session:v1" as const;

export type SessionEntryKind =
  | "user" | "agent" | "tool_call" | "tool_result" | "system";

export interface Session {
  "@type": "Session";
  "@id": string;              // urn:refarm:session:v1:{id}
  participants: string[];     // array of URNs
  context_id: string | null;
  created_at_ns: number;
}

export interface SessionEntry {
  "@type": "SessionEntry";
  "@id": string;              // urn:refarm:session-entry:v1:{id}
  session_id: string;
  parent_entry_id: string | null;  // linked list for branch-safe history
  kind: SessionEntryKind;
  content: string;
  timestamp_ns: number;
}

export interface SessionContractAdapter {
  create(session: Omit<Session, "@id" | "created_at_ns">): Promise<Session>;
  get(id: string): Promise<Session | null>;
  update(id: string, patch: Partial<Omit<Session, "@id" | "@type">>): Promise<Session>;
  appendEntry(entry: Omit<SessionEntry, "@id" | "timestamp_ns">): Promise<SessionEntry>;
  entries?(sessionId: string, limit?: number): Promise<SessionEntry[]>;
  query?(filter: SessionFilter): Promise<Session[]>;
}

export function runSessionV1Conformance(
  adapter: SessionContractAdapter
): Promise<SessionConformanceResult>;
```

---

## Test Coverage

**Conformance tests (required — any adapter):**

- [x] `create()` returns Session with `@id`, `@type`, `created_at_ns` set
- [x] `get()` returns the same Session by `@id`
- [x] `appendEntry()` returns SessionEntry linked to correct `session_id`;
      `parent_entry_id` chain is correct for sequential appends

**Conformance tests (optional — run when adapter implements the method):**

- [x] `entries(sessionId, limit)` returns entries in chronological order; limit respected
- [x] `query({ participants })` filters correctly

**Integration tests (in adapters, not in this package):**

- [ ] Loro CRDT adapter: SessionEntry linked list survives snapshot/restore
- [ ] Loro CRDT adapter: pi-agent extra fields (`leaf_entry_id`) round-trip without
      corrupting base fields read by a base-contract consumer

**Migration test:**

- [ ] Namespace migration script rewrites `urn:pi-agent:session-*` →
      `urn:refarm:session:v1:*` without data loss

---

## Implementation Tasks

**SDD:**

- [x] Design `Session` / `SessionEntry` / `SessionContractAdapter` TypeScript interfaces
- [x] Design `runSessionV1Conformance` test harness
- [x] Design pi-agent extension model (extra CRDT fields, no coupling)
- [x] Design namespace migration strategy
- [x] Write design doc (`docs/superpowers/specs/2026-05-03-task-session-contracts-design.md`)
- [x] Write ADR-057 (`specs/ADRs/ADR-057-task-session-contracts.md`)
- [x] Write feature spec (this document)

**TDD:**

- [x] Conformance runner in `packages/session-contract-v1/src/conformance.ts`
- [x] In-memory adapter that passes all 5 conformance checks
- [ ] Namespace migration script unit test (rewrites URNs, preserves data)

**DDD:**

- [x] Scaffold `packages/session-contract-v1/` with types, conformance runner,
      in-memory adapter
- [ ] Write namespace migration script (`scripts/migrate-pi-agent-sessions.ts`)
- [ ] Migrate pi-agent's CRDT reads/writes to use `session-contract-v1` adapter
- [ ] Implement `SessionContractAdapter` in `storage-sqlite` backed by Loro CRDT
- [ ] Expose conversation history in Homestead via standard adapter
- [ ] Smoke gate: pi-agent creates Session → node in CRDT graph → Homestead reads it

---

## References

- [Design doc](../../docs/superpowers/specs/2026-05-03-task-session-contracts-design.md)
- [ADR-057: task-contract-v1 + session-contract-v1](../ADRs/ADR-057-task-session-contracts.md)
- [ADR-052: CRDT-native agent rendezvous](../ADRs/ADR-052-crdt-native-agent-rendezvous.md)
- [ADR-045: Loro CRDT adoption](../ADRs/ADR-045-loro-crdt-adoption.md)
- [ADR-046: Composition model](../ADRs/ADR-046-composition-model.md)
- [task-contract-v1 spec](./task-contract-v1.md)
- [Session management spec](./session-management.md)
