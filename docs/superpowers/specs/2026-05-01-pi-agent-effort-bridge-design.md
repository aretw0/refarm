# Pi-Agent ↔ Effort Queue Bridge — Design Doc

**Date:** 2026-05-01  
**Status:** Approved  
**Feature:** Slice 6.3 — Pi-Agent callable via effort queue

---

## Context

Milestones 1–5 delivered the full effort execution pipeline: `effort-contract-v1`, `FileTransportAdapter`,
HTTP sidecar, `refarm task run/status/list/logs/retry/cancel`. The pipeline is generic — any loaded
plugin function can be dispatched as a task.

Pi-agent (the sovereign AI plugin) is not yet reachable via this pipeline because:

1. Its `integration` WIT interface has no callable function that returns the LLM response.
   `on_event("user:prompt", prompt)` writes to CRDT and returns void — unusable as a task result.
2. Farmhand only loads plugins via `PluginRoute` CRDT nodes — no auto-boot from installed plugins.
3. `refarm-plugin-host.wit` exists as a manual copy in both `packages/pi-agent/wit/` and
   `packages/tractor/wit/host/`, creating silent drift risk.

This slice closes all three gaps.

---

## Canonical WIT Package (`packages/refarm-plugin-wit/`)

### Problem

Two copies of `refarm-plugin-host.wit` live in separate directories. Any change must be applied
twice manually. As agents accelerate feature development, this guarantees eventual drift.

### Solution

A dedicated Cargo workspace package `packages/refarm-plugin-wit/` becomes the single canonical
source for the `refarm:plugin@0.1.0` WIT contract.

```
packages/refarm-plugin-wit/
  Cargo.toml                   ← [package.metadata.component] package = "refarm:plugin"
  wit/
    refarm-plugin-host.wit     ← all interfaces + host world (sole canonical copy)
```

**Pi-agent** removes its local `wit/refarm-plugin-host.wit` and adds a WIT dependency:

```toml
# packages/pi-agent/Cargo.toml
[package.metadata.component.target.dependencies]
"refarm:plugin" = { path = "../refarm-plugin-wit" }
```

`packages/pi-agent/wit/world.wit` stays local (pi-agent-specific world) and imports from the
dependency package.

**Tractor** changes its `bindgen!` path in `src/host/plugin_host/core.rs`:

```rust
wasmtime::component::bindgen!({
    world: "refarm-plugin-host",
    path: "../../refarm-plugin-wit/wit",   // was "wit/host"
    async: true,
});
```

`tractor/wit/host/refarm-plugin-host.wit` is deleted — it is replaced by the canonical copy.
`tractor/wit/host/agent-tools/` is untouched — it is `refarm:agent-tools@0.1.0`, a separate
package with no dependency on `refarm:plugin`.

**Publishing path:** `refarm-plugin-wit` is already a Cargo package. When publishing begins,
add `publish = true` and third-party plugin authors gain a versioned crate dependency.
No structural change needed at that point.

---

## `respond` — New WIT Export

### Addition to `integration` interface

```wit
interface integration {
    // ... existing: setup, ingest, push, teardown, get-help-nodes, metadata, on-event
    respond: func(payload: string) -> result<string, plugin-error>;
}
```

### Payload (JSON string input)

```json
{ "prompt": "...", "system": "optional system prompt override" }
```

`system` is optional; when absent, `LLM_SYSTEM` env var applies as usual.

### Return (JSON string on success)

```json
{
  "content": "...",
  "model": "claude-sonnet-4-6",
  "provider": "anthropic",
  "usage": {
    "tokens_in": 120,
    "tokens_out": 340,
    "estimated_usd": 0.0012
  }
}
```

### Side effects

Pi-agent writes `UserPrompt` + `AgentResponse` nodes to the CRDT exactly as `on_event` does —
for audit trail and conversational history. The return value is a normalized copy of the same data.

### Error path

LLM failure or budget block → `Err(plugin-error::internal("..."))` → task executor maps to
`TaskResult { status: "error", error: "..." }`. No changes to the task executor needed.

### Why the executor needs zero changes

`instance.call("respond", JSON.stringify(args))` is already the generic call pattern in
`apps/farmhand/src/task-executor.ts`. The result flows through `TaskResult.result` unchanged.

---

## Plugin Auto-Boot in Farmhand

### Directory convention

```
~/.refarm/
  plugins/
    pi-agent/
      plugin.json    ← PluginManifest
      pi-agent.wasm  ← compiled binary
```

### New function: `loadInstalledPlugins`

Added to `apps/farmhand/src/index.ts`:

```typescript
async function loadInstalledPlugins(tractor: Tractor, baseDir: string): Promise<void>
```

1. Reads `<baseDir>/plugins/*/plugin.json` — skips missing directory silently
2. Validates each manifest with `assertValidPluginManifest`
3. Calls `tractor.registry.register` + `tractor.registry.trust` + `tractor.plugins.load`
   (same path as existing `handlePluginRoute`)
4. Per-plugin failure: warn + continue — never aborts the boot sequence

Called in `main()` immediately after `tractor.boot()`:

```typescript
await loadInstalledPlugins(tractor, farmhandBaseDir);
```

### Building blocks for B and C

- **B (explicit load):** `loadInstalledPlugins` is a pure function — a future
  `refarm plugin load <id>` command calls it with a specific path; no new abstraction.
- **C (demand-load):** task executor can call `loadInstalledPlugins` filtered by `pluginId`
  when `tractor.plugins.get(pluginId)` returns undefined; a single `if (!instance) tryLoad()`
  guard suffices.

---

## End-to-End Flow

```
refarm task run pi-agent respond --args '{"prompt":"o que é CRDT?"}' --direction "pesquisa"

  FileTransportAdapter.submit()
    → writes ~/.refarm/tasks/<effortId>.json

  FileTransportAdapter.watch()
    → picks up file
    → executeTask({ pluginId: "pi-agent", fn: "respond", args: { prompt: "..." } })
      → tractor.plugins.get("pi-agent")          ← loaded at boot
      → instance.call("respond", '{"prompt":"..."}')
        → pi-agent Rust: respond(payload)
          → runs LLM pipeline
          → writes UserPrompt + AgentResponse to CRDT
          → returns { content, model, provider, usage }
      → TaskResult { status: "ok", result: { content, model, ... } }
    → writes ~/.refarm/task-results/<effortId>.json

refarm task status <effortId>
  → reads result file
  → prints content + model + token usage
```

---

## Test Strategy

### Rust — pi-agent (`extensibility_contract`)

- New axiom **A6 — respond returns complete structure**: mock `llm-bridge` returns fixed response;
  verify `respond` returns JSON with `content`, `model`, `provider`, `usage` present.
- Verify `UserPrompt` + `AgentResponse` CRDT writes occur as side effects.
- Verify `respond` returns `Err` when LLM bridge returns error.

### TypeScript — Farmhand (Vitest)

- `loadInstalledPlugins`: temp dir with one valid + one invalid `plugin.json`;
  verify valid loads, invalid warns without throwing, both cases leave Farmhand running.
- All 27 existing tests remain green.

### Smoke gate extension

`scripts/ci/smoke-task-execution-loop.mjs` gains a `pi-agent respond` scenario using a
stub LLM (env `LLM_PROVIDER=stub` or similar) that returns a fixed response without a real
API call. Verifies `TaskResult.result` contains `content` + `usage`.

---

## Non-Goals

- Streaming responses via effort queue (future — implement `subscribe` on transport)
- Multi-turn conversations across efforts (Slice 6.2 scope)
- Demand-load (C) implementation (building blocks ready; full impl is future)
- Real LLM call in smoke gate (covered by existing pi-agent Rust tests)
