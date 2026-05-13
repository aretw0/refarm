# Graceful Plugin Reload + `llm` → `model` Rename

**Date:** 2026-05-13
**Status:** Approved

---

## Context

Two concerns are addressed together because they both block the daily-driver milestone:

1. `POST /plugins/reload` currently swaps WASM modules mid-execution, crashing any in-flight task.
2. The codebase uses `llm` throughout (env vars, WIT interface, identifiers) when `model` is the correct term — "llm" excludes smaller models and is semantically incorrect for a provider-agnostic system.

---

## Part 1 — Graceful Plugin Reload

### Goal

When `/reload` is triggered in the `refarm` REPL, farmhand reloads each plugin:
- **immediately** if no in-flight efforts are using it, or
- **deferred** until the last in-flight effort using it completes.

The CLI polls until all deferred reloads complete (Option 2), architected so fire-and-forget SSE notification (Option 1) is a natural next step — the `reloadId` abstraction enables both without changing the endpoint contract.

### Architecture

```
PluginUsageTracker (new)
  ├── pluginId → Set<effortId>         (who is using what right now)
  └── idleCallbacks per pluginId       (EventEmitter, one callback per plugin)

FileTransportAdapter (modified, additive)
  └── optional constructor hooks:
        onEffortStart(effortId, pluginIds[])
        onEffortEnd(effortId)

loadInstalledPlugins (modified)
  └── options?: { pluginFilter?: string[] }   (undefined = reload all)

createPluginsRouteHandler (rewritten)
  ├── POST /plugins/reload     → { reloadId, reloaded[], deferred[], skipped[] }
  └── GET  /plugins/reload/status/:reloadId → { pending[], completed[], failed[] }

CLI: /reload REPL command (new, in session.ts)
  └── POST → poll GET /status/:reloadId (500 ms) → spinner per deferred plugin
```

### Component Contracts

#### `PluginUsageTracker`

```typescript
class PluginUsageTracker {
  registerEffort(effortId: string, pluginIds: string[]): void
  releaseEffort(effortId: string): void
  isIdle(pluginId: string): boolean
  onIdle(pluginId: string, callback: () => void): void
}
```

Backed by Node's `EventEmitter`. `onIdle` uses `emitter.once(`idle:${pluginId}`, cb)`. On `releaseEffort`: remove effortId from every plugin's set; for any plugin whose count drops to zero, emit `idle:${pluginId}`.

**Coalescing:** If a second `onIdle` is registered for a plugin that already has a pending callback, no second once-listener is added. Instead, the new `reloadId` is recorded as also waiting on that plugin. When the single physical reload completes, all waiting `reloadId`s are marked `completed`.

#### `FileTransportAdapter` — new options

```typescript
interface FileTransportOptions {
  onEffortStart?: (effortId: string, pluginIds: string[]) => void;
  onEffortEnd?:   (effortId: string) => void;
}
```

`processEffort` calls `onEffortStart(effort.id, effort.tasks.map(t => t.pluginId))` before marking in-flight, and `onEffortEnd(effort.id)` in the `finally` block. Both hooks are optional — existing behaviour is unchanged when absent.

#### `loadInstalledPlugins` — new filter option

```typescript
loadInstalledPlugins(
  tractor: PluginLoaderTarget,
  baseDir: string,
  options?: { pluginFilter?: string[] },
  logger?: LoggerLike,
): Promise<{ loaded: number; skipped: number }>
```

When `pluginFilter` is provided, only plugins whose `manifest.id` appears in the array are loaded. Others are silently skipped.

#### `POST /plugins/reload`

```typescript
// Request body (optional JSON)
{ pluginIds?: string[] }   // omit or empty = all installed plugins

// Response 200
{
  reloadId: string,         // UUID — use for polling or future SSE
  reloaded: string[],       // reloaded immediately (was idle)
  deferred: string[],       // in-flight; will reload when effort completes
  skipped:  string[],       // manifest unreadable or load failed
}
```

#### `GET /plugins/reload/status/:reloadId`

```typescript
// Response 200
{ reloadId: string, pending: string[], completed: string[], failed: string[] }

// Response 404 — unknown or evicted (TTL: 5 minutes)
{ error: "not found" }
```

Status entries are kept in a `Map<reloadId, ReloadStatus>` in memory and evicted after 5 minutes.

### Data Flow

**Immediate reload:**
```
POST /plugins/reload
  → tracker.isIdle("plugin-a") === true
  → loadInstalledPlugins(target, baseDir, { pluginFilter: ["plugin-a"] })
  → return { reloadId: "abc", reloaded: ["plugin-a"], deferred: [], skipped: [] }
```

**Deferred reload:**
```
POST /plugins/reload
  → tracker.isIdle("plugin-b") === false
  → tracker.onIdle("plugin-b", () => reload + mark "abc".completed["plugin-b"])
  → return { reloadId: "abc", reloaded: [], deferred: ["plugin-b"], skipped: [] }

                ↓ later, when effort finishes

FileTransportAdapter.processEffort() → finally
  → onEffortEnd(effortId)
  → tracker.releaseEffort(effortId)
  → plugin-b count drops to 0 → emit "idle:plugin-b"
  → reload fires: loadInstalledPlugins(..., { pluginFilter: ["plugin-b"] })
  → status["abc"].pending removes "plugin-b", adds to "completed"
```

**CLI `/reload` flow:**
```
User types: /reload
  → POST /plugins/reload → { reloadId, reloaded, deferred }
  → print "✓ plugin-a reloaded"
  → if deferred.length > 0:
      poll GET /plugins/reload/status/:reloadId every 500 ms
      show spinner: "⏳ plugin-b: waiting for active tasks..."
      when pending is empty: print "✓ plugin-b reloaded" (or "✗ failed")
  → return to prompt
```

### Error Handling

| Scenario | Behaviour |
|---|---|
| Manifest unreadable at reload time | `skipped[]`, log warn |
| WASM fails to load (deferred) | `failed[]` in status map, log error |
| `reloadId` unknown or expired (>5 min) | `GET /status/:id` → 404 |
| No plugins installed | `{ reloaded:[], deferred:[], skipped:[] }`, 200 OK |
| Unknown `pluginId` in request body | included in `skipped[]` |
| Second reload requested while first is deferred | coalesced — one physical reload, both `reloadId`s updated |

### Wiring in `index.ts`

```typescript
const tracker = new PluginUsageTracker();

const taskExecutorFn: TaskExecutorFn = async (task, effortId) => { ... };

const fileTransport = new FileTransportAdapter(farmhandBaseDir, taskExecutorFn, {
  onEffortStart: (effortId, pluginIds) => tracker.registerEffort(effortId, pluginIds),
  onEffortEnd:   (effortId)            => tracker.releaseEffort(effortId),
});

httpSidecar.addRouteHandler(
  createPluginsRouteHandler(tractor, farmhandBaseDir, tracker)
);
```

### Testing

- `PluginUsageTracker` — unit tests: register/release, idle callbacks, coalescing, zero-count edge case
- `FileTransportAdapter` hooks — extend existing test file: verify `onEffortStart` receives correct pluginIds, `onEffortEnd` fires in finally (including on task error)
- `createPluginsRouteHandler` — extend existing tests: immediate reload, deferred reload, status polling, coalescing, 404 on unknown reloadId
- CLI `/reload` — unit test mocking farmhand HTTP: shows spinner for deferred, exits when pending is empty

---

## Part 2 — `model` → `model` Rename

### Rationale

The term `model` (Large Language Model) is semantically incorrect for a provider-agnostic system that may route to small models, local models (Ollama/Phi/Gemma), or specialised embedding models. `model` is the correct umbrella term. This was a naming mistake from early development; the project is pre-release so no backward compatibility is needed.

### Scope

#### WIT Interface (`packages/refarm-plugin-wit`)

`refarm-plugin-host.wit`:
- `interface model-bridge` → `interface model-bridge`
- `import model-bridge` in world `refarm-plugin-host` → `import model-bridge`
- Doc comment: "Host-proxied model completion bridge" → "Host-proxied model completion bridge"

#### `packages/pi-agent`

`wit/world.wit`:
- `import llm-bridge` → `import model-bridge`

`src/provider.rs`:
- `use crate::refarm::plugin::llm_bridge` → `model_bridge`
- All `llm_bridge::complete_http(...)` → `model_bridge::complete_http(...)`
- `LLM_MODEL` env var → `MODEL_ID` (avoids redundant `MODEL_MODEL`)
- `LLM_BASE_URL` → `MODEL_BASE_URL`

`src/lib.rs` — env var rename table:

| Old | New |
|---|---|
| `LLM_PROVIDER` | `MODEL_PROVIDER` |
| `LLM_DEFAULT_PROVIDER` | `MODEL_DEFAULT_PROVIDER` |
| `LLM_MODEL` | `MODEL_ID` |
| `LLM_BASE_URL` | `MODEL_BASE_URL` |
| `LLM_MAX_CONTEXT_TOKENS` | `MODEL_MAX_CONTEXT_TOKENS` |
| `LLM_FALLBACK_PROVIDER` | `MODEL_FALLBACK_PROVIDER` |
| `LLM_BUDGET_<PROVIDER>_USD` | `MODEL_BUDGET_<PROVIDER>_USD` |
| `LLM_HISTORY_TURNS` | `MODEL_HISTORY_TURNS` |
| `LLM_TOOL_CALL_MAX_ITER` | `MODEL_TOOL_CALL_MAX_ITER` |
| `LLM_TOOL_OUTPUT_MAX_LINES` | `MODEL_TOOL_OUTPUT_MAX_LINES` |
| `LLM_STREAM_RESPONSES` | `MODEL_STREAM_RESPONSES` |
| `LLM_SYSTEM` | `MODEL_SYSTEM` |
| `LLM_SESSION_ID` | `MODEL_SESSION_ID` |

`src/streaming_config.rs`:
- `LLM_STREAM_RESPONSES_ENV` const → `MODEL_STREAM_RESPONSES_ENV`

`src/compress.rs`:
- `LLM_TOOL_OUTPUT_MAX_LINES` env var read → `MODEL_TOOL_OUTPUT_MAX_LINES`

`src/extensibility_contract.rs`:
- `LLM_PROVIDER` set/remove → `MODEL_PROVIDER`
- `LLM_DEFAULT_PROVIDER` → `MODEL_DEFAULT_PROVIDER`

`src/response_nodes.rs`:
- `"llm": { "model": ..., "tokens_in": ..., ... }` schema key → `"inference": { "model": ..., "tokens_in": ..., ... }`
  (renaming to `"model"` would be redundant since the nested field is already called `"model"`; `"inference"` correctly describes the container's purpose)

#### `packages/tractor-ts`

`src/lib/wasi-imports.ts`:
- `"refarm:plugin/llm-bridge"` → `"refarm:plugin/model-bridge"`
- `REFARM_MOCK_LLM_BODY` → `REFARM_MOCK_MODEL_BODY`
- `REFARM_LLM_HTTP_TIMEOUT_SEC` → `REFARM_MODEL_HTTP_TIMEOUT_SEC`
- Local variable names: `mockLlm*` → `mockModel*`
- Error messages: `"llm-bridge request failed"` → `"model-bridge request failed"`

`test/wasi-imports.test.ts`:
- `"refarm:plugin/llm-bridge"` → `"refarm:plugin/model-bridge"`
- `REFARM_MOCK_LLM_BODY` → `REFARM_MOCK_MODEL_BODY`

#### `apps/farmhand`

`src/index.ts`:
- `const LLM_ENV_KEY` → `MODEL_ENV_KEY`
- `async function injectSiloLlmEnv()` → `injectSiloModelEnv()`
- `process.env.LLM_PROVIDER` → `process.env.MODEL_PROVIDER`

#### `apps/refarm`

`src/commands/ask.ts`:
- `process.env.LLM_PROVIDER` reads → `MODEL_PROVIDER`
- `.env` file parsing: `LLM_PROVIDER=...` match regex → `MODEL_PROVIDER=...`
- Error strings: `"llm provider unavailable"` → `"model provider unavailable"`, `"No LLM provider configured"` → `"No model provider configured"`
- `"llm-bridge request failed"` error match → `"model-bridge request failed"`

`src/commands/keys.ts`:
- `.description("Configure LLM provider API keys")` → `"Configure model provider API keys"`

`src/commands/session-launch.ts`:
- `"Configure your LLM provider"` → `"Configure your model provider"`
- `"No LLM provider configured"` → `"No model provider configured"`
- `process.env.LLM_PROVIDER` → `MODEL_PROVIDER`

#### ADRs and Docs

Files to update `llm` → `model` in content:
- `specs/ADRs/ADR-053-host-proxied-llm-streaming.md` — filename + title: `llm-streaming` → `model-streaming`
- `specs/ADRs/ADR-012-hybrid-model-routing-for-pi-agent-harness.md` — content references
- `specs/ADRs/ADR-054-generic-stream-observations.md` — content references
- `specs/ADRs/ADR-031-pluggable-relational-storage.md` — content references
- `specs/ADRs/ADR-057-task-session-contracts.md` — content references
- `specs/ADRs/ADR-058-context-injection-doctrine.md` — content references
- `specs/ADRs/ADR-065-farmhand-transparent-lifecycle.md` — content references
- `specs/ADRs/README.md` — index entry for ADR-053
- `specs/features/`, `docs/` — all `llm-bridge` → `model-bridge` and `LLM_*` references

---

## Implementation Order

1. **Part 2 first** (rename) — mechanical, no logic changes; cleans up the surface before adding new abstractions
2. **Part 1** (graceful reload) — builds on the clean `model-bridge` naming

### Rust rebuild note

After renaming `llm-bridge` → `model-bridge` in the WIT file, regenerate bindings:
- `pi-agent`: `cargo build` (bindgen picks up new WIT automatically)
- `tractor-ts`: `npm run build` in that package (jco transpile reads the WIT)

---

## Non-goals

- Backward compatibility shims for `LLM_*` env vars — not needed, pre-release
- SSE-based fire-and-forget CLI (Option 1) — designed for, not implemented here
- Renaming the `keys` command — separate UX decision
