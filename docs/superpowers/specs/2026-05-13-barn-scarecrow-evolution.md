# Barn + Scarecrow Evolution Path

**Date:** 2026-05-13  
**Status:** Approved — implementation deferred pending daily-driver milestone  
**Author:** Arthur Silva

---

## Context

Two components are under-utilized relative to their potential as the plugin ecosystem matures:

- **Barn** — currently has the right contract (`installWasmArtifact` + `PluginBinaryCacheAdapter`) but farmhand bypasses it entirely, scanning `~/.refarm/plugins/` directly
- **Scarecrow** — named "System Auditor" but lacks a concrete runtime role now that WASM is mature

The guiding principle: **every primitive must be extensible from day one** — contract-first, implementation-replaceable — so that any future contributor can improve an implementation without changing consumers.

---

## Current State (as of 2026-05-13)

### What already exists and is correct

| Primitive | Location | Role |
|---|---|---|
| `installWasmArtifact(req, { cache })` | `packages/plugin-manifest/src/install-contract.js` | Canonical install: fetch → SHA-256 verify → cache via adapter |
| `PluginBinaryCacheAdapter` | `packages/plugin-manifest/src/install-contract.js` | Interface: `get(pluginId)`, `set(pluginId, bytes, metadata)`, `evict(pluginId)` |
| `Barn` class | `packages/barn/src/index.ts` | Browser-side: in-memory adapter + `installPlugin(url, id, integrity)` |
| `plugin.json` manifest | `packages/plugin-manifest` | Canonical plugin descriptor — the stable anchor for all of the above |
| `loadInstalledPlugins(tractor, baseDir, options?, logger?)` | `apps/farmhand/src/installed-plugins.ts` | Daemon-side: raw filesystem scan, not integrated with Barn |
| `listInstalledPluginIds(baseDir)` | `apps/farmhand/src/installed-plugins.ts` | Lists plugin IDs from filesystem |
| `PluginUsageTracker` | `apps/farmhand/src/plugin-usage-tracker.ts` | Tracks in-flight efforts per plugin — Scarecrow embryonic |

### The gap

Farmhand (daemon) and Barn (browser/in-memory) solve the same problem with different implementations and no shared code path. The install contract in `plugin-manifest` is designed to bridge both but the bridge is not built.

---

## Domain Separation — Long-Term Boundaries

```
┌─────────────────────────────────────────────────────────┐
│  plugin-manifest (stable contracts, no runtime deps)    │
│    installWasmArtifact()  ·  PluginBinaryCacheAdapter   │
│    PluginManifest  ·  assertValidPluginManifest()        │
└──────────────────┬──────────────────────────────────────┘
                   │ used by
       ┌───────────┴───────────┐
       ▼                       ▼
┌─────────────┐       ┌─────────────────────────────┐
│    Barn     │       │         Farmhand              │
│  (browser)  │       │  (daemon / CLI sidecar)       │
│             │       │                               │
│ in-memory   │       │ FilesystemCacheAdapter        │
│ adapter     │       │ (Step 1 — to be built)        │
│             │       │                               │
│ OPFS adapter│       │ installWasmArtifact() via     │
│ (Step 2)    │       │ shared contract (Step 2)      │
└─────────────┘       └───────────────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │      Scarecrow        │
                    │  (host-side observer) │
                    │                       │
                    │ WIT observation hooks │
                    │ (Step 3 — additive)   │
                    │                       │
                    │ Policy plugin         │
                    │ (Step 4 — replaceable)│
                    └──────────────────────┘
```

---

## Evolution Sequence

### Step 0 — Done ✅

Farmhand's scan already uses `baseDir` (parametrized, not hardcoded). Manifests are canonical via `plugin-manifest`. `PluginUsageTracker` tracks effort/plugin relationships. No new coupling was added.

### Step 1 — FilesystemCacheAdapter

**File:** `apps/farmhand/src/filesystem-cache-adapter.ts`

```typescript
import fs from "node:fs/promises";
import path from "node:path";
import type { PluginBinaryCacheAdapter } from "@refarm.dev/plugin-manifest";

export function createFilesystemCacheAdapter(baseDir: string): PluginBinaryCacheAdapter {
  const cacheDir = path.join(baseDir, "plugins");

  return {
    async get(pluginId: string): Promise<ArrayBuffer | null> {
      const wasmPath = path.join(cacheDir, pluginId, `${pluginId}.wasm`);
      try {
        const buf = await fs.readFile(wasmPath);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      } catch {
        return null;
      }
    },

    async set(pluginId: string, bytes: ArrayBuffer): Promise<void> {
      const pluginDir = path.join(cacheDir, pluginId);
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(path.join(pluginDir, `${pluginId}.wasm`), Buffer.from(bytes));
    },

    async evict(pluginId: string): Promise<void> {
      const pluginDir = path.join(cacheDir, pluginId);
      await fs.rm(pluginDir, { recursive: true, force: true });
    },
  };
}
```

**Why:** This is the only change needed to make `installWasmArtifact` work in the daemon. The install contract, integrity verification, and SHA-256 all come for free.

**Extensibility:** Anyone can provide an alternative adapter — S3, encrypted local store, distributed cache — without changing `installWasmArtifact` or Barn.

### Step 2 — Farmhand uses installWasmArtifact

Replace `loadInstalledPlugins` internals to call `installWasmArtifact` instead of raw `fs.readFileSync`:

- On startup: scan existing `plugin.json` manifests → call `installWasmArtifact` with `force: false` (cache hit path, no download)
- On `POST /plugins/install`: call `installWasmArtifact` with the URL + integrity from the manifest
- On `POST /plugins/reload`: call `installWasmArtifact` with `force: true` for the specific plugin

This unifies the install flow: integrity verification, binary kind detection, and metadata are always produced the same way regardless of whether the source is the filesystem or a remote URL.

**Barn's role evolves:** Barn becomes the browser-side implementation of the same contract. A future `OPFSCacheAdapter` follows the same `PluginBinaryCacheAdapter` interface. Both browser and daemon call `installWasmArtifact` — the contract is the same, the adapter differs.

### Step 3 — Scarecrow: WIT Observation Hooks (additive)

**Daemon path (Rust tractor) — IMPLEMENTED** in
`packages/tractor/src/host/agent_tools_bridge/core.rs`.

Every `agent-fs` and `agent-shell` call now emits two observation signals:

1. **`tracing::info!`** — structured log line with `plugin_id`, `op`, path/argv,
   byte counts, exit codes, and `duration_ms` (spawn only). Visible via the
   daemon's `RUST_LOG` subscriber.

2. **`TelemetryBus.emit_named`** — typed events (`agent-tool:fs:read`,
   `agent-tool:fs:write`, `agent-tool:fs:edit`, `agent-tool:shell:spawn`)
   with JSON payloads. Any subscriber can receive them without touching the
   bridge; future Scarecrow policy plugins will subscribe here.

Both signals are additive — no WIT contracts changed, no plugin recompile
needed. Existing callers are unaffected.

**Note on tractor-ts:** The TypeScript tractor (`packages/tractor-ts`) is the
browser / OPFS path; its `wasi-imports.ts` agent-fs and agent-shell stubs are
intentional no-ops. Observation hooks for that path follow when the browser
daily-driver track requires them. The Rust tractor is the production engine for
`refarm chat`; all daemon-path observation lives in `core.rs`.

### Step 4 — Scarecrow: Policy as Privileged Plugin

A Scarecrow plugin subscribes to observation events via a host-provided `scarecrow-bridge` WIT interface:

```wit
interface scarecrow-bridge {
  record wit-call-event {
    plugin-id: string,
    interface-name: string,
    function-name: string,
    duration-ms: u32,
  }
  report-wit-call: func(event: wit-call-event) -> ();
}
```

Farmhand loads the Scarecrow plugin like any other WASM plugin but with elevated trust. The policy implementation is fully replaceable: anyone can write a better Scarecrow that enforces different quotas or reports to a different sink.

**Separation:** observation (Step 3, in host, not replaceable without touching tractor-ts) vs policy (Step 4, in plugin, radically replaceable).

---

## What Must Never Be Coupled

| Don't do | Do instead |
|---|---|
| Hardcode `~/.refarm/plugins/` path anywhere | Always pass `baseDir` |
| Load WASM bytes without SHA-256 check | Always go through `installWasmArtifact` |
| Implement a new cache without `PluginBinaryCacheAdapter` | Implement the interface |
| Put observation logic inside plugin code | Put it in the WIT host (tractor-ts) |
| Put policy logic in the host | Put it in the policy plugin (replaceable) |

---

## Non-Goals (Scope of This Doc)

- Barn UI/browser integration (separate feature)  
- Scarecrow a11y/performance metrics (original mandate — orthogonal to watchdog role)  
- Plugin registry / remote install flow (separate feature)  
- Scarecrow policy enforcement actions (suspend/evict) — follow-on after Step 4

---

## References

- `packages/plugin-manifest/src/install-contract.js` — `installWasmArtifact`, `PluginBinaryCacheAdapter`
- `packages/barn/src/index.ts` — current Barn implementation (in-memory adapter)
- `apps/farmhand/src/installed-plugins.ts` — current daemon-side scan (Step 1 replacement target)
- `apps/farmhand/src/plugin-usage-tracker.ts` — Scarecrow embryonic (effort tracking)
- `packages/tractor-ts/src/lib/wasi-imports.ts` — WIT host bridge (Step 3 insertion point)
- `docs/v0.1.0-release-gate.md` — Gate 2: Plugin Ecosystem (Barn)
