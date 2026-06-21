# Feature: Farmhand Graceful Plugin Reload

**Status**: Planned
**Version**: v0.1.0
**Owner**: Arthur Silva

---

## Summary

Adds a `/reload` command to the `refarm` interactive session (REPL) that tells Farmhand to
reload installed WASM plugins from disk without restarting the daemon.

Farmhand reloads each plugin **immediately** when it has no in-flight tasks, or **defers** the
reload until the last active task using that plugin completes — ensuring no running task has
its WASM module swapped mid-execution.

The CLI polls Farmhand's status endpoint and shows per-plugin progress until all reloads
complete. The architecture is designed so that future evolution to SSE-based fire-and-forget
notification requires no changes to the endpoint contract.

---

## User Stories

### Story 1: Reload after plugin update

**As a** plugin developer  
**I want** to type `/reload` in my running `refarm` session  
**So that** Farmhand picks up my updated WASM binary without restarting the daemon or losing my session history

### Story 2: Safe reload during active tasks

**As a** Refarm user  
**I want** Farmhand to wait for in-flight tasks to finish before reloading the plugin they use  
**So that** my running tasks complete normally and are not corrupted by a mid-execution plugin swap

### Story 3: Visibility into deferred reloads

**As a** Refarm user  
**I want** the CLI to show me which plugins are reloading immediately and which are deferred  
**So that** I know what is happening and when to expect the reload to be complete

### Story 4: Targeted reload

**As a** plugin developer  
**I want** to reload a specific plugin by ID (`/reload my-plugin`)  
**So that** I don't trigger unnecessary reloads of other plugins that haven't changed

---

## Acceptance Criteria

### AC1: Immediate reload (no active tasks)

**Given** `pi-agent` is installed and Farmhand has no in-flight efforts using it  
**When** the user types `/reload` in the `refarm` REPL  
**Then** Farmhand reloads `pi-agent` from disk immediately  
**And** the CLI prints `✓ pi-agent reloaded` and returns to the prompt

### AC2: Deferred reload (tasks in flight)

**Given** an effort using `pi-agent` is currently in-progress  
**When** the user types `/reload`  
**Then** Farmhand queues the reload and responds with `deferred: ["pi-agent"]`  
**And** the CLI shows `⏳ pi-agent: waiting for active tasks…`  
**And** once the in-flight effort completes, Farmhand reloads the plugin  
**And** the CLI updates to `✓ pi-agent reloaded` and returns to the prompt

### AC3: Mixed reload (some idle, some busy)

**Given** `pi-agent` has no active tasks and `my-plugin` has one active task  
**When** the user types `/reload`  
**Then** `pi-agent` is reloaded immediately and `my-plugin` is deferred  
**And** the CLI shows both statuses simultaneously, resolving each as it completes

### AC4: Targeted reload

**Given** multiple plugins are installed  
**When** the user types `/reload pi-agent`  
**Then** only `pi-agent` is reloaded; other plugins are not affected

### AC5: Failed reload does not crash Farmhand

**Given** the WASM binary for `pi-agent` is corrupt or unreadable at reload time  
**When** the reload is attempted  
**Then** Farmhand logs the error and marks the plugin as `failed`  
**And** the CLI prints `✗ pi-agent: failed to reload (see farmhand logs)`  
**And** the daemon continues running; previously loaded (working) instance remains

### AC6: Coalesced reloads

**Given** `/reload` was called and `pi-agent` is deferred  
**When** `/reload` is called again before the first deferred reload completes  
**Then** a single physical reload occurs when the plugin becomes idle  
**And** both callers see the plugin move to `completed`

---

## Technical Approach

See design doc: [`Feature: Plugin Lifecycle`](./plugin-lifecycle.md)

### New components

| Component | Location | Purpose |
|---|---|---|
| `PluginUsageTracker` | `apps/farmhand/src/plugin-usage-tracker.ts` | Tracks `pluginId → Set<effortId>`; emits idle events |
| `/reload` REPL command | `apps/refarm/src/commands/session.ts` | CLI trigger + polling loop |

### Modified components

| Component | Change |
|---|---|
| `FileTransportAdapter` | Adds optional `onEffortStart` / `onEffortEnd` hooks |
| `loadInstalledPlugins` | Adds optional `pluginFilter?: string[]` |
| `createPluginsRouteHandler` | Rewrites to support deferred reloads + status endpoint |

### HTTP API (Farmhand sidecar — port 42001)

```
POST /plugins/reload
Body: { pluginIds?: string[] }   // omit = all installed
→ { reloadId, reloaded[], deferred[], skipped[] }

GET /plugins/reload/status/:reloadId
→ { pending[], completed[], failed[] }   // 404 after 5 min TTL
```

### Future evolution path

The `reloadId` returned by `POST /plugins/reload` also acts as the subscription key for a
future `GET /plugins/reload/status-stream/:reloadId` SSE endpoint. Switching the CLI from
polling to SSE requires no changes to the Farmhand endpoint contract.

---

## Test Coverage

- [ ] `PluginUsageTracker` unit tests: register/release, idle callbacks, coalescing, zero-count
- [ ] `FileTransportAdapter` — `onEffortStart` receives correct pluginIds; `onEffortEnd` fires in `finally` even on task error
- [ ] `createPluginsRouteHandler` — immediate reload, deferred reload, status polling, coalescing, 404 on unknown reloadId
- [ ] CLI `/reload` — mocked farmhand HTTP: spinner shown for deferred, resolves when pending is empty, handles failed plugins

---

## References

- [Plugin lifecycle spec](./plugin-lifecycle.md)
- [ADR-065: Farmhand Transparent Lifecycle](../ADRs/ADR-065-farmhand-transparent-lifecycle.md)
