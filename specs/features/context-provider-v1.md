# Feature: context-provider-v1 + `refarm ask`

**Status**: In Progress  
**Version**: v0.1.0  
**Owner**: Arthur Silva

---

## Summary

Adds `context-provider-v1` as a composable capability contract for building context-aware
system prompts, and `refarm ask` as a direct conversational CLI command that auto-injects
project context (cwd, date, git status, files) and streams pi-agent's response token by
token to the terminal. Together these are the primitives that make a future TUI emerge
naturally — without building the TUI itself.

---

## User Stories

**As a** Refarm developer  
**I want** to type `refarm ask "o que é CRDT?"` and see a streamed response  
**So that** I can get an AI answer with automatic project context without writing JSON payloads

**As a** Refarm developer  
**I want** to pass `--files src/lib/foo.ts` and have pi-agent see the file content  
**So that** I can ask questions about specific parts of the codebase without copy-pasting

**As a** third-party plugin author  
**I want** `context-provider-v1` to define a composable `ContextProvider` interface  
**So that** I can inject domain-specific context (e.g., Linear tickets, Notion pages) into
pi-agent's system prompt without modifying `refarm ask`

---

## Acceptance Criteria

1. **Given** a Farmhand daemon is running with pi-agent loaded  
   **When** `refarm ask "o que é CRDT?"` is executed  
   **Then** tokens print to stdout as they arrive and a usage footer appears at the end

2. **Given** `--files CLAUDE.md,package.json` is passed  
   **When** `refarm ask` runs  
   **Then** those file contents are included in the system prompt (truncated at 4 KB each)

3. **Given** the current directory is not a git repo  
   **When** `refarm ask` runs  
   **Then** the git status provider is silently skipped and the command still succeeds

4. **Given** a `ContextProvider` implementation is registered  
   **When** one provider throws during `collect()`  
   **Then** the exception is swallowed and all other providers still contribute their entries

5. **Given** pi-agent streams `StreamChunk` nodes via `stream-contract-v1`  
   **When** `refarm ask` subscribes to the `FileStreamTransport`  
   **Then** a late-starting subscriber still receives past chunks in order before live ones

6. **Given** pi-agent returns `is_final: true`  
   **When** `refarm ask` receives it  
   **Then** a summary line with `model`, `tokens_in`, `tokens_out`, and `estimated_usd` is printed

---

## Technical Approach

**High-level design:**

```
refarm ask "<query>" [--files f1,f2]
  │
  ├─ ContextRegistry.collect({ cwd, query })
  │    ├─ CwdContextProvider       (priority 10)
  │    ├─ DateContextProvider      (priority 20)
  │    ├─ GitStatusContextProvider (priority 30)
  │    └─ FilesContextProvider     (priority 50, if --files given)
  │
  ├─ buildSystemPrompt(entries)  →  system: string
  │
  ├─ POST /tasks to Farmhand HTTP (port 42001)
  │    { pluginId:"pi-agent", fn:"respond", args:{ prompt, system } }
  │    → effortId + stream_ref
  │
  └─ FileStreamTransport.subscribe(stream_ref, onChunk)
       → print chunk.content to stdout
       → on is_final: print usage footer
```

**Package layout:**

```
packages/
  context-provider-v1/
    src/
      index.ts
      providers/cwd.ts · date.ts · git-status.ts · files.ts
    package.json

apps/refarm/src/commands/ask.ts
```

**Key decisions:**

- Context is injected via the `system` field in the `respond` payload — no changes to
  pi-agent or the effort executor needed.
- `ContextRegistry` runs all providers in parallel (`Promise.allSettled`) for fast startup.
- Streaming uses `FileStreamTransport` from `stream-contract-v1` — replay semantics handle
  the race between effort submission and subscription.
- `refarm ask` is additive — `refarm task run pi-agent respond` remains the low-level escape
  hatch; `ask` is the ergonomic shortcut.

---

## API/Interface

```typescript
// packages/context-provider-v1/src/index.ts

export const CONTEXT_CAPABILITY = "context:v1" as const;

export interface ContextRequest {
  cwd: string;
  query?: string;
}

export interface ContextEntry {
  label: string;
  content: string;
  priority?: number; // lower = higher in prompt; default 100
}

export interface ContextProvider {
  readonly name: string;
  readonly capability: typeof CONTEXT_CAPABILITY;
  provide(request: ContextRequest): Promise<ContextEntry[]>;
}

export class ContextRegistry {
  constructor(providers: ContextProvider[]);
  async collect(request: ContextRequest): Promise<ContextEntry[]>;
}

export function buildSystemPrompt(entries: ContextEntry[]): string;
```

```typescript
// Bundled providers
export class CwdContextProvider implements ContextProvider { /* priority 10 */ }
export class DateContextProvider implements ContextProvider { /* priority 20 */ }
export class GitStatusContextProvider implements ContextProvider { /* priority 30 */ }
export class FilesContextProvider implements ContextProvider { /* priority 50 */ }
```

```
# CLI
refarm ask "<query>" [--files <file1,file2,...>]
```

---

## Test Coverage

**Unit tests (TDD):**

- [x] `buildSystemPrompt` sorts by priority and wraps with preamble
- [x] `ContextRegistry` collects all providers in parallel
- [x] `ContextRegistry` isolates a throwing provider — others still contribute
- [x] `GitStatusContextProvider` returns empty array when not in a git repo
- [x] `FilesContextProvider` truncates files at 4 KB with label
- [x] `ask` command assembles correct payload and submits to Farmhand HTTP adapter
- [x] `ask` command prints chunks to stdout and usage footer on `is_final`

**Smoke gate:**

- [x] `refarm ask "what is 2+2?"` with stub LLM prints streamed tokens and usage footer

---

## Implementation Tasks

**SDD:**

- [x] Design `ContextProvider` / `ContextRegistry` / `buildSystemPrompt` contract
- [x] Design `refarm ask` command flow
- [x] Write design doc
- [x] No new ADR needed — follows ADR-018 capability contract model

**TDD:**

- [x] `buildSystemPrompt` unit tests in `packages/context-provider-v1/`
- [x] `ContextRegistry` isolation tests
- [x] Provider unit tests (cwd, date, git-status, files)
- [x] `ask` command unit tests in `apps/refarm/`
- [x] Smoke gate scenario

**DDD:**

- [x] Scaffold `packages/context-provider-v1/` with all types and bundled providers
- [x] Implement `ContextRegistry` with `Promise.allSettled` parallel collection
- [x] Implement `buildSystemPrompt` with priority sorting and XML-style context wrapping
- [x] Add `ask.ts` command to `apps/refarm/src/commands/`
- [x] Wire `refarm ask` in `apps/refarm/src/program.ts`
- [x] Add `@refarm.dev/context-provider-v1` and `@refarm.dev/file-stream-transport`
  as dependencies in `apps/refarm/package.json`
- [x] Smoke gate: verify end-to-end with stub LLM

---

## References

- [Design doc](../../docs/superpowers/specs/2026-05-02-context-provider-v1-design.md)
- [stream-contract-v1 spec](./stream-contract-v1.md)
- [Pi-Agent Effort Bridge spec](./pi-agent-effort-bridge.md)
- [ADR-018: Capability Contracts and Observability Gates](../ADRs/ADR-018-capability-contracts-and-observability-gates.md)
- [ADR-055: stream-contract-v1 as Separate Transport Package Family](../ADRs/ADR-055-stream-contract-v1-transport-layer.md)
