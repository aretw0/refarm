# Feature: `refarm chat` — Daily Driver Conversational REPL

**Status**: In Progress
**Phase**: P12 — Daily-Driver-TUI
**Owner**: arthursilva.dev@gmail.com

---

## Summary

`refarm chat` is an interactive REPL that lets the user replace Pi (pi.dev) and Claude Code as their primary AI tool. It wraps the existing `ask` single-turn flow in a persistent readline loop, talking to the already-running farmhand sidecar at `:42001`. Session history persists between invocations via the existing session-lock mechanism. A `/reload` REPL command triggers hot-reload of plugins inside farmhand without restarting the daemon.

---

## Architecture Decision: DEC-036

**Decision: Option B — REPL as a client of the farmhand sidecar (HTTP :42001)**

The `ask` command already establishes this pattern through the `AskDeps` interface:
`submitEffort` → `POST /efforts`, `followStream` → NDJSON polling. The chat REPL reuses the same interface — it is `ask` in a loop.

**Why not Option A (embedded farmhand)?**
- Farmhand is already running as a daemon; embedding it creates two competing instances
- `addRouteHandler` in `HttpSidecar` is the clean extension point for the `/plugins/reload` endpoint
- Multiple consumers (chat + web studio + scripts) can coexist without restart

**Implication for `refarm chat`**: it is a client of the Farmhand sidecar, but
the user-facing launcher may make Farmhand lifecycle transparent. If Farmhand is
not running, launch policy is controlled by `.refarm/config.json` `autostart`
or `REFARM_FARMHAND_AUTOSTART=always|ask|never`; the default is `ask`.

---

## User Stories

**As a** developer using refarm as daily driver
**I want** a persistent interactive REPL that streams responses and preserves session history
**So that** I can iterate on tasks without the per-invocation overhead of `refarm ask`

**As a** developer testing plugin changes live
**I want** a `/reload` command inside the REPL
**So that** updated plugins take effect without exiting the session or restarting farmhand

---

## Acceptance Criteria

1. **Given** farmhand is running at `:42001`
   **When** user runs `refarm chat`
   **Then** a `>` prompt appears; user input is sent as an effort and the response streams in real-time

2. **Given** a running `refarm chat` session
   **When** user types `/reload`
   **Then** farmhand reloads all installed plugins and REPL prints a confirmation message

3. **Given** a running `refarm chat` session
   **When** user types `/new`
   **Then** a fresh session ID is generated; conversation history starts over

4. **Given** a completed `refarm chat` session
   **When** user runs `refarm chat` again
   **Then** the previous session ID is restored from session-lock, preserving history

5. **Given** farmhand is NOT running and autostart policy is `never`
   **When** user runs `refarm chat`
   **Then** an actionable error is printed and process exits 1

6. **Given** farmhand is NOT running and autostart policy is `ask` or `always`
   **When** user runs `refarm chat`
   **Then** the launcher asks or starts according to policy, polls readiness,
   and enters the REPL only after Farmhand is ready

---

## Technical Approach

### Components

```
apps/refarm/src/commands/
  chat.ts          — Commander command, ChatDeps interface, wires readline loop
  chat-repl.ts     — Pure REPL loop logic (no readline, no process — fully testable)

apps/farmhand/src/transports/
  plugins.ts       — createPluginsRouteHandler: POST /plugins/reload
```

### Data Flow

```
User types text
  → readline (chat.ts)
  → buildChatEffort() (reuses ask.ts context building)
  → ChatDeps.submitEffort()  [POST /efforts to farmhand]
  → ChatDeps.followStream()  [polls ~/.refarm/streams/<id>.ndjson]
  → process.stdout.write(chunk.content)
  → next readline prompt

User types /reload
  → ChatDeps.reloadPlugins() [POST /plugins/reload to farmhand]
  → farmhand route handler calls tractor.plugins.reload()
  → REPL prints ✓ plugins reloaded
```

### ChatDeps Interface

```typescript
export interface ChatDeps {
  // Inherited from ask — same sidecar call
  submitEffort(effort: Effort): Promise<string>;
  followStream(
    effortId: string,
    onChunk: (chunk: StreamChunk) => void,
    options?: { timeoutMs?: number; submittedAtMs?: number },
  ): Promise<void>;

  // Session management — delegates to session-lock
  readActiveSessionId(): string | null;
  persistActiveSessionId(id: string): void;
  clearActiveSessionId(): void;

  // Reload — new endpoint on farmhand
  reloadPlugins(): Promise<{ reloaded: number }>;

  // I/O — injected for testability
  readline: ReadlineInterface; // from node:readline
  stdout: NodeJS.WriteStream;
}
```

### REPL Loop Contract (`chat-repl.ts`)

```typescript
export interface ChatReplDeps {
  onLine(line: string): Promise<ReplResult>;
  onReload(): Promise<void>;
  onNewSession(): void;
  onExit(): void;
}

export type ReplResult =
  | { kind: "response"; content: string; metadata?: Record<string, unknown> }
  | { kind: "command_ack"; message: string }
  | { kind: "error"; message: string };
```

### Farmhand: `POST /plugins/reload`

New route handler in `apps/farmhand/src/transports/plugins.ts`:

```typescript
export function createPluginsRouteHandler(
  tractor: { plugins: { reload(): Promise<number> } },
): RouteHandler {
  // POST /plugins/reload
  // Response: { reloaded: number }
}
```

Registered in `farmhand/src/index.ts` alongside the sessions route handler:

```typescript
httpSidecar.addRouteHandler(createPluginsRouteHandler(tractor));
```

---

## REPL Commands

| Command | Effect |
|---------|--------|
| `/reload` | Hot-reload plugins in farmhand (`POST /plugins/reload`) |
| `/new` | Start a fresh session (clears session-lock) |
| `/session <prefix>` | Switch to session matching prefix |
| `/exit` | Exit REPL gracefully |
| `/help` | Print available commands |

Any input NOT starting with `/` is sent as a conversation message.

---

## Command Surface

```
refarm chat [options]

Options:
  --new              Start fresh session (discard history)
  --session <id>     Resume specific session by ID or prefix
  --timeout <ms>     Per-turn stream timeout (default: 45000)
  -h, --help         Show help
```

---

## Test Coverage

**Unit tests (TDD):**
- [ ] `chat-repl.ts`: REPL routes `/reload` to `onReload`, not `onLine`
- [ ] `chat-repl.ts`: REPL routes `/new` to `onNewSession`
- [ ] `chat-repl.ts`: REPL routes plain text to `onLine(text)`
- [ ] `plugins.ts`: route handler returns `{ reloaded: N }` on POST /plugins/reload
- [ ] `plugins.ts`: route handler returns 405 on GET /plugins/reload

**Integration tests (BDD):**
- [ ] Full turn: submit effort → follow stream → print response
- [ ] `/reload` calls farmhand and prints confirmation
- [ ] Session persists after `chat` exits and re-enters

---

## Implementation Sequence

1. **`apps/farmhand/src/transports/plugins.ts`** — `POST /plugins/reload` route handler
   - Unit test first (mock tractor.plugins)
   - Wire into `index.ts` via `addRouteHandler`

2. **`apps/refarm/src/commands/chat-repl.ts`** — pure REPL loop
   - No readline, no process; accepts `ChatReplDeps` callbacks
   - Unit-testable without I/O

3. **`apps/refarm/src/commands/chat.ts`** — Commander command
   - Wires `readline`, `ChatDeps`, and `chat-repl.ts`
   - Reuses `defaultDeps()` pattern from `ask.ts`
   - Registers in `apps/refarm/src/index.ts`

---

## References

- [DEC-036](../../.project/decisions.json) — TUI architecture decision (resolved above)
- [P12-Daily-Driver-TUI](../../.project/phases/P12-Daily-Driver-TUI.json) — Phase plan
- [ask.ts](../../apps/refarm/src/commands/ask.ts) — Pattern to follow for ChatDeps
- [farmhand/transports/http.ts](../../apps/farmhand/src/transports/http.ts) — addRouteHandler extension point
- [farmhand/transports/sessions.ts](../../apps/farmhand/src/transports/sessions.ts) — Reference for route handler pattern
