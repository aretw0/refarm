# Context Provider v1 + `refarm ask` — Design Doc

**Date:** 2026-05-02  
**Status:** Approved  
**Feature:** Slice 7.2 — context-provider-v1 + refarm ask conversational command

---

## Context

Slice 6.3 added `pi-agent respond` as an effort-queue callable function returning
`{ content, model, provider, usage }`. The respond payload already accepts an optional
`system` field that overrides `LLM_SYSTEM` for that call alone.

Stream-contract-v1 (Slice 7.1) delivers `StreamChunk` nodes from Farmhand to File/SSE/WS
consumers.

What's missing is:
1. A composable TypeScript contract for building context-aware system prompts.
2. A `refarm ask` CLI command that ties it all together: gathers project context,
   dispatches to pi-agent, and streams the response token by token to the terminal.

This slice builds those two pieces. It deliberately avoids building a TUI — instead it
lays the primitives that make a TUI emerge naturally (streaming output, composable context,
identifiable stream refs per session).

---

## `context-provider-v1` — Capability Contract

### Package: `packages/context-provider-v1/`

```typescript
export const CONTEXT_CAPABILITY = "context:v1" as const;

export interface ContextRequest {
  cwd: string;
  query?: string;
}

export interface ContextEntry {
  label: string;
  content: string;
  priority?: number; // lower = higher priority in prompt assembly; default 100
}

export interface ContextProvider {
  readonly name: string;
  readonly capability: typeof CONTEXT_CAPABILITY;
  provide(request: ContextRequest): Promise<ContextEntry[]>;
}

export function buildSystemPrompt(entries: ContextEntry[]): string;
```

`buildSystemPrompt` sorts by `priority`, then assembles entries as:

```
<context label="cwd">...</context>
<context label="git_status">...</context>
<context label="files">...</context>
```

Wrapped in a preamble:
```
You are pi-agent, a sovereign AI assistant for a Refarm node.
The following project context has been collected automatically:
<contexts>
...
</contexts>
Answer the user's question using this context.
```

### Bundled Providers

| Provider | `name` | `priority` | What it provides |
|---|---|---|---|
| `CwdContextProvider` | `cwd` | 10 | `process.cwd()` absolute path |
| `DateContextProvider` | `date` | 20 | ISO date + day of week |
| `GitStatusContextProvider` | `git_status` | 30 | `git status --short` + last 5 commits |
| `FilesContextProvider` | `files` | 50 | content of explicitly requested files (truncated at 4 KB each) |

All bundled in `packages/context-provider-v1/src/providers/`.

### Composability

```typescript
const registry = new ContextRegistry([
  new CwdContextProvider(),
  new DateContextProvider(),
  new GitStatusContextProvider(),
  new FilesContextProvider({ files: ["CLAUDE.md", "package.json"] }),
]);

const entries = await registry.collect({ cwd: process.cwd(), query });
const system = buildSystemPrompt(entries);
```

`ContextRegistry` runs all providers in parallel (`Promise.allSettled`) — one failing
provider never blocks others.

---

## `refarm ask` — CLI Command

### Location: `apps/refarm/src/commands/ask.ts`

```
refarm ask "o que é CRDT?"
refarm ask "what changed in the last 3 commits?" --files CHANGELOG.md
refarm ask "review this function" --files src/lib/foo.ts
```

### Flow

```
refarm ask "<query>"
  1. ContextRegistry collects entries (cwd, date, git_status, [files])
  2. buildSystemPrompt(entries) → system string
  3. POST /tasks to Farmhand HTTP sidecar (port 42001):
       { pluginId: "pi-agent", fn: "respond",
         args: { prompt: query, system },
         direction: "ask" }
     → effortId + stream_ref
  4. Subscribe to FileStreamTransport for stream_ref
  5. Print each StreamChunk.content to stdout as it arrives
  6. On is_final=true: print newline + usage summary
```

### Output format

```
pi-agent ▸ o que é CRDT?

Um CRDT (Conflict-free Replicated Data Type) é uma estrutura de dados...
[tokens print as they arrive]

─────────────────────────────────────────
model: claude-sonnet-4-6  tokens: 120 in / 340 out  ~$0.0012
```

No spinner, no progress bar — raw tokens to stdout. A future TUI can intercept and
decorate this stream; the primitive works stand-alone.

### Connection between pi-agent and stream_ref

`pi-agent respond` writes `StreamChunk` nodes to the CRDT keyed by a `stream_ref` derived
from the effort ID. Farmhand's `StreamRegistry` broadcasts those nodes to all registered
transports including `FileStreamTransport`. `refarm ask` subscribes to the file transport
for that `stream_ref` immediately after submitting the effort.

This means streaming works even if the effort is processed asynchronously — the file
transport accumulates chunks, and the subscriber replays from offset 0 on first connect.

---

## Why Not Extend `refarm task run`?

`refarm task run pi-agent respond --args '...'` already works. `refarm ask` is not a
replacement — it's a higher-level command that:

1. Auto-injects context (no `--args` JSON to write)
2. Streams output live (no `refarm task status` polling)
3. Presents a natural conversational UX

Both coexist. `refarm task run` remains the low-level escape hatch.

---

## End-to-End Flow

```
refarm ask "o que é CRDT?"

  ContextRegistry.collect()
    → CwdContextProvider:     "/workspaces/refarm"
    → DateContextProvider:    "2026-05-02, Saturday"
    → GitStatusContextProvider: "On branch develop\n..."

  buildSystemPrompt(entries)
    → "<contexts>...</contexts>" enriched system string

  POST /tasks { pluginId:"pi-agent", fn:"respond",
                args:{ prompt:"o que é CRDT?", system }, direction:"ask" }
    → effortId + stream_ref

  FileStreamTransport.subscribe(stream_ref, onChunk)
    → prints tokens as StreamChunk nodes arrive from pi-agent LLM call

  is_final=true
    → prints usage footer
```

---

## Package Layout

```
packages/
  context-provider-v1/
    src/
      index.ts           ← exports ContextProvider, ContextRequest, ContextEntry,
                            ContextRegistry, buildSystemPrompt
      providers/
        cwd.ts
        date.ts
        git-status.ts
        files.ts
    package.json

apps/refarm/
  src/
    commands/
      ask.ts             ← new: refarm ask command
```

---

## Test Strategy

### Unit tests — `packages/context-provider-v1/`

- `buildSystemPrompt` orders entries by priority and wraps with correct preamble
- `ContextRegistry` runs all providers in parallel and isolates failures
- `GitStatusContextProvider` handles missing git repo silently (returns empty)
- `FilesContextProvider` truncates files at 4 KB and labels them correctly

### Unit tests — `apps/refarm/` (Vitest)

- `ask` command assembles context, submits correct payload to Farmhand HTTP adapter
- `ask` command subscribes to stream_ref and prints chunks to stdout
- `ask` command prints usage footer on `is_final=true`

### Smoke gate

`scripts/ci/smoke-task-execution-loop.mjs` gains an `ask` scenario:
- `refarm ask "what is 2+2?"` with stub LLM
- Verifies tokens appear on stdout
- Verifies usage footer after final chunk

---

## Non-Goals

- Multi-turn conversation (Slice 8+ — requires session state across calls)
- TUI rendering (emerges from this primitive; not built here)
- Semantic file selection (future: embedding-based relevance ranking)
- `refarm ask --session` for persistent conversation threads
