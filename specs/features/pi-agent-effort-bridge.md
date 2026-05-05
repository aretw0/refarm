# Feature: Pi-Agent ↔ Effort Queue Bridge

**Status**: Done  
**Version**: v0.1.0  
**Owner**: Arthur Silva

---

## Summary

Makes `pi-agent` (the sovereign AI plugin) callable via the effort queue. Adds a `respond`
function to the WIT `integration` contract, enables Farmhand to auto-boot installed plugins,
and consolidates the `refarm:plugin@0.1.0` WIT definition into a single canonical package
(`packages/refarm-plugin-wit/`) to eliminate silent drift between tractor and pi-agent.

---

## User Stories

**As a** Refarm developer  
**I want** to dispatch a prompt to pi-agent via `refarm task run pi-agent respond`  
**So that** I can get an AI response from the terminal without opening Studio

**As a** Refarm developer  
**I want** `refarm task status <id>` to show the AI response content and token usage  
**So that** I can audit what the agent produced and what it cost

**As a** third-party plugin author  
**I want** `refarm:plugin@0.1.0` to have a single canonical WIT source  
**So that** I can depend on it without worrying about stale copies

---

## Acceptance Criteria

1. **Given** pi-agent is installed in `~/.refarm/plugins/pi-agent/`  
   **When** Farmhand boots  
   **Then** pi-agent is loaded and available without any manual command

2. **Given** Farmhand is running with pi-agent loaded  
   **When** `refarm task run pi-agent respond --args '{"prompt":"..."}' --direction "..."` is executed  
   **Then** an `effortId` is printed and the effort file appears in `~/.refarm/tasks/`

3. **Given** the effort is processed  
   **When** `refarm task status <effortId>` is run  
   **Then** `TaskResult.result` contains `content`, `model`, `provider`, and `usage`

4. **Given** the LLM call fails or budget is exceeded  
   **When** `respond` is invoked  
   **Then** `TaskResult` has `status: "error"` with a descriptive error message

5. **Given** `packages/refarm-plugin-wit/wit/refarm-plugin-host.wit` is modified  
   **When** pi-agent and tractor are built  
   **Then** both pick up the change automatically — no manual copy needed

6. **Given** one installed plugin has an invalid manifest  
   **When** Farmhand boots  
   **Then** that plugin is skipped with a warning and all other plugins load normally

---

## Technical Approach

**High-level design:**

```
packages/refarm-plugin-wit/          ← new: canonical WIT source for refarm:plugin@0.1.0
  Cargo.toml
  wit/refarm-plugin-host.wit         ← sole copy of integration, tractor-bridge, etc.

packages/pi-agent/
  wit/world.wit                      ← kept local (pi-agent world)
  wit/refarm-plugin-host.wit         ← REMOVED (now a WIT dependency)
  src/lib.rs                         ← fn respond(payload: String) -> Result<String, PluginError>

packages/tractor/
  src/host/plugin_host/core.rs       ← bindgen path updated to refarm-plugin-wit
  wit/host/refarm-plugin-host.wit    ← REMOVED

apps/farmhand/
  src/index.ts                       ← loadInstalledPlugins() called after boot
```

**Key decisions:**

- `respond` returns a normalized JSON string (not raw JSON-LD) — consumers get `content`,
  `model`, `provider`, `usage` without parsing CRDT internals
- Side effect: `UserPrompt` + `AgentResponse` still written to CRDT for audit and history
- Plugin load failure is isolated — one bad plugin never aborts Farmhand boot
- WIT path dependency uses cargo-component 0.21.x `[target.dependencies]` — publishable as-is

---

## API/Interface

```wit
// Addition to interface integration in refarm-plugin-host.wit
respond: func(payload: string) -> result<string, plugin-error>;
```

```typescript
// TaskResult.result shape when fn = "respond"
interface RespondResult {
  content: string;
  model: string;
  provider: string;
  usage: {
    tokens_in: number;
    tokens_out: number;
    estimated_usd: number;
  };
}
```

```typescript
// New function in apps/farmhand/src/index.ts
async function loadInstalledPlugins(tractor: Tractor, baseDir: string): Promise<void>
```

---

## Test Coverage

**Unit tests (TDD):**

- [x] `respond` returns complete structure — mock LLM bridge, verify JSON fields
- [x] `respond` returns `Err` on LLM failure
- [x] `respond` writes `UserPrompt` + `AgentResponse` to CRDT as side effects (axiom A6)
- [x] `loadInstalledPlugins` — valid plugin loads, invalid skips with warning
- [x] `loadInstalledPlugins` — missing `plugins/` dir is silently ignored

**Smoke gate extension:**

- [x] `pi-agent respond` effort round-trip with stub LLM — `TaskResult.result` has `content` + `usage`

---

## Implementation Tasks

**SDD:**

- [x] Design WIT canonical package structure
- [x] Design `respond` contract (input/output/side effects)
- [x] Design auto-boot mechanism
- [x] Write feature spec

**TDD:**

- [x] Axiom A6-aligned contract test (`respond` structure) in `packages/pi-agent/src/tests/respond_contract_tests.rs`
- [x] `respond` error path test (invalid payload without prompt)
- [x] `loadInstalledPlugins` unit tests in farmhand
- [x] Smoke gate pi-agent scenario

**DDD:**

- [x] Scaffold `packages/refarm-plugin-wit/` with Cargo.toml
- [x] Move `refarm-plugin-host.wit` to canonical location
- [x] Update pi-agent WIT dependency in Cargo.toml
- [x] Update tractor `bindgen!` path in `core.rs`
- [x] Add `respond` to WIT interface
- [x] Implement `fn respond` in `packages/pi-agent/src/lib.rs`
- [x] Implement `loadInstalledPlugins` in `apps/farmhand/src/index.ts`
- [x] Wire `loadInstalledPlugins` in `main()`
- [x] Smoke gate: verify end-to-end with stub LLM

---

## References

- [Design doc](../../docs/superpowers/specs/2026-05-01-pi-agent-effort-bridge-design.md)
- [Farmhand Task Execution spec](./farmhand-task-execution.md)
- [Pi-agent ROADMAP](../../packages/pi-agent/ROADMAP.md)
