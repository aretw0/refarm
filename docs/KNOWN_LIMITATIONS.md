# Refarm Known Limitations & Mitigation Strategy

**Purpose**: Honest inventory of architectural "backdoors" and how we'll handle them. No surprises.

---

## Philosophy: Know Your Enemies

> "A system that doesn't know its limits will discover them at the worst possible time — in production, when users are angry."

We explicitly document:

1. **What can go wrong** (worst-case scenarios)
2. **When we'll know** (early warning signals)
3. **What we'll do** (mitigation plan)
4. **When we'll fix** (prioritization)

---

## Category 1: Resource Exhaustion

### Limitation 1.1: OPFS Quota Can Fill Up

**Worst Case**:

- User creates 100k nodes
- Each node has 10KB of data
- Total: 1GB used
- Browser quota: depends on device (Chrome ~60% of disk)
- **User hits quota → writes fail → data loss**

**Early Warning Signals**:

```typescript
// Detect when approaching quota
navigator.storage.estimate().then(({ usage, quota }) => {
  const percentUsed = (usage / quota) * 100;
  
  if (percentUsed > 80) {
    // RED ALERT: user needs to take action
  } else if (percentUsed > 60) {
    // YELLOW: warn user proactively
  }
});
```

**Mitigation (v0.2.0)**:

1. **Resource Observatory Plugin** (see below)
2. Warn user when 60% full
3. Offer export/archive options
4. Block new writes at 95% (preserve integrity)

**Status**: ⚠️ Not implemented yet, but design ready

---

### Limitation 1.2: SQLite/OPFS Can Corrupt (CRDT State)

**Worst Case**:

- Browser crash mid-write
- Loro CRDT state in SQLite becomes inconsistent (truncated binary delta)
- User opens app → state vector mismatch, sync refuses to merge

**Early Warning**:

- Checksum failures on read (ADR-021 Layer 1)
- Loro state vector fails to decode (binary integrity check)

**Mitigation (v0.3.0)**:

- Atomic SQLite commit wraps data row + Loro delta together (ADR-045 CQRS)
- Checksum validation on every read
- Auto-repair: rollback to last valid Loro snapshot, replay deltas forward

**Note**: CRDT state is now stored in SQLite (co-located with data), not in IndexedDB.
IndexedDB is no longer part of the storage stack since ADR-045 (Loro adoption).

**Status**: ⚠️ Design complete (ADR-021 + ADR-045), implementation pending

---

### Limitation 1.3: Memory Can Blow Up from Bad Plugin

**Worst Case**:

- Third-party plugin leaks memory (allocates but never frees)
- After 10 minutes: 500MB consumed
- Browser tab crashes → user loses work

**Early Warning**:

```typescript
// Plugin Citizenship Monitor tracks per-plugin memory
if (plugin.memoryUsage > plugin.quota) {
  // Throttle immediately
  citizenshipMonitor.throttle(plugin.id, 0.1); // 10% quota
}
```

**Mitigation (v0.3.0)**:

- Plugin citizenship monitoring (ADR-021)
- Per-plugin memory quotas (declared in manifest)
- Automatic throttling → isolation → quarantine

**Status**: ⚠️ Design complete (ADR-021), implementation pending

---

## Category 2: Multi-Device Sync

### Limitation 2.1: Conflict Avalanche (Cascading Edits)

**Worst Case**:

- Device A: 1000 edits offline
- Device B: 1000 edits offline (same nodes)
- Both sync → CRDT merges 2000 operations
- Result: Slow (can take 10+ seconds), UI freezes

**Early Warning**:

- Sync operation counter (operations pending > 1000)
- Detect when two devices have been offline for days

**Mitigation (v0.2.0)**:

- Background sync (don't block UI)
- Progress indicator ("Merging 2000 changes...")
- CRDT compaction (merge operations into snapshots)

**Status**: ⚠️ Needs implementation + UX design

---

### Limitation 2.2: Schema Version Mismatch

**Worst Case**:

- Device A: v0.1.0 (schema v0)
- Device B: v0.3.0 (schema v2)
- B syncs data in v2 → A can't parse it → silent data loss

**Early Warning**:

- Version negotiation on sync handshake
- Detect when peer has incompatible schema

**Mitigation (Already Designed)**:

- Schema upcasting (ADR-010) handles v0 → v1 → v2
- Graceful downgrade (salvage readable fields)
- Reject sync if gap too large (e.g., v0 ↔ v5)

**Status**: ✅ Design complete (ADR-010), ready for implementation

---

## Category 3: Plugin Ecosystem Chaos

### Limitation 3.1: Malicious Plugin Can Steal Data

**Worst Case**:

- User installs "helpful plugin"
- Plugin has `network:write` capability
- Plugin exfiltrates graph to attacker server

**Early Warning**:

- Capability审查 in manifest
- Network operations logged by observability

**Mitigation (v0.4.0)**:

- Capability permissions (user approves before install)
- Network operations require explicit user consent
- Sandbox isolation (WASM can't access DOM directly)

**Status**: ⚠️ Basic capability system exists, advanced isolation pending

---

### Limitation 3.0: `PluginHost.load()` Not Available in Browser Without OPFS Cache

**Worst Case**:

- Browser app imports `@refarm.dev/tractor` and calls `tractor.plugins.load(manifest)`
- Runtime throws: *"PluginHost requires the Node.js runtime or a pre-installed WASM cache"*
- Plugin features are unavailable; app must handle the error or degrade gracefully

**When We'll Know**:

- Vite build error if `node:fs`, `node:path`, or `@bytecodealliance/jco` are bundled for browser (early)
- Runtime error in browser console when `load()` is called without a prior `installPlugin()` (late)

**Mitigation**:

- `@refarm.dev/tractor` exports a `browser` condition (`index.browser.js`) that replaces `PluginHost` with a stub. Vite resolves this automatically — no bundler configuration needed.
- Calling `load()` throws a descriptive error pointing to [ADR-044](../specs/ADRs/ADR-044-wasm-plugin-loading-browser-strategy.md).
- Future: `installPlugin(manifest, wasmUrl)` will cache the JCO-transpiled module to OPFS so subsequent `load()` calls work offline in the browser.

**Status**: ✅ Build-time mitigation (export condition) implemented. `installPlugin()` pending (ADR-044 step 3).

---

### Limitation 3.2: Plugin Conflict (Two Plugins Compete for Same Resource)

**Worst Case**:

- Plugin A: Manages task priority
- Plugin B: Also manages task priority
- Both write to same field → endless conflict loop

**Early Warning**:

- Capability collision detection
- Multiple plugins declaring same write paths

**Mitigation (v0.3.0)**:

- Manifest declares "write paths" (which fields plugin modifies)
- Kernel warns user if two plugins conflict
- User chooses which plugin wins (policy)

**Status**: ⚠️ Design needed (ADR-022, see below)

---

## Category 4: Homestead UI Freezes

### Limitation 4.1: Too Many Nodes Rendered at Once

**Worst Case**:

- User opens view with 10,000 nodes
- Astro/browser renders all at once
- UI freezes for 10 seconds

**Early Warning**:

- Flame graph shows render time > 100ms
- User reports "Homestead is slow"

**Mitigation (v0.2.0)**:

- Virtual scrolling (only render visible nodes)
- Pagination (show 100 at a time)
- Progressive rendering (render critical first)

**Status**: ⚠️ UI optimization needed

---

### Limitation 4.2: Infinite Loop in Plugin

**Worst Case**:

- Plugin has bug: `while(true) {}`
- Blocks event loop
- UI becomes unresponsive

**Early Warning**:

- Plugin execution time > 5 seconds
- Watchdog timer fires

**Mitigation (v0.3.0)**:

- Watchdog timer kills long-running operations
- Plugin isolated in Web Worker (doesn't block main thread)
- User notified + plugin auto-disabled

**Status**: ⚠️ Web Worker isolation needed

---

## Category 5: User Experience Disasters

### Limitation 5.1: User Doesn't Know What Broke

**Worst Case**:

- Data mysteriously disappears
- User doesn't know which plugin caused it
- No way to debug

**Early Warning**:

- Missing observability (can't trace operations)

**Mitigation (v0.2.0)**:

- Observability primitives (ADR-007)
- Studio DevTools showing operation log
- "Who modified this node?" audit trail

**Status**: ⚠️ ADR-007 draft, implementation needed

---

### Limitation 5.2: User Loses Work (No Undo)

**Worst Case**:

- User deletes 100 nodes by accident
- No undo button
- Data gone forever

**Early Warning**:

- No version history

**Mitigation (v0.2.0-0.3.0)**:

- Graph versioning (ADR-020) enables undo/redo
- Commit before destructive operations
- Revert to last good state

**Status**: ⚠️ ADR-020 design complete, implementation pending

---

## Category 6: Licensing & Legal

### Limitation 6.1: User Doesn't Know License of Their Data

**Worst Case**:

- User creates content in Refarm
- Shares with someone
- Recipient claims "no license = public domain"
- Legal dispute

**Early Warning**:

- No license metadata on nodes

**Mitigation (v0.2.0)**:

- License selector in graph metadata
- Support Creative Commons, proprietary, etc.
- Display license badge in Homestead UI

**Status**: ⚠️ Not designed yet (new requirement)

---

## Category 7: Test Coverage Gaps

### Limitation 7.1: Astro Files Not Type-Checked by Default

**Discovered**: 2026-03-09 (PluginInstance.state missing in homestead index.astro)

**Worst Case**:

- TypeScript errors in `.astro` `<script>` sections go undetected
- Code deploys to production with type mismatches
- Runtime errors in browser (worse UX, harder to debug)

**Why It Happened**:

1. **`tsc` doesn't process `.astro` files**: TypeScript compiler only checks `.ts`, `.tsx`, `.js`
2. **No `astro check` in CI/hooks**: Astro's type-checker wasn't integrated in pre-push or workflows
3. **Homestead excluded from test matrix**: `granular-tests.yml` focuses on `packages/**`, not `apps/**`
4. **Deploy skips type-check**: `deploy-homestead.yml` only runs `turbo build`, no validation

**Early Warning Signals**:

- Editor shows red squiggles (user saw this first!)
- Manual `astro check` reveals errors
- Runtime errors in browser console

**Mitigation (Implemented 2026-03-09)**:

✅ **Immediate**:
- Added `astro:check` script to homestead package.json
- Integrated `astro check` into `lint` and `type-check` scripts  
- Pre-push hooks now catch Astro type errors

⚠️ **Future (v0.2.0)**:
- Add homestead E2E tests to CI matrix (Playwright)
- Create smoke tests for plugin registration flow
- Document Astro-specific patterns in DEVELOPMENT_WORKFLOW.md

**Status**: ✅ Mitigated for homestead; pattern documented for future apps

**Lessons Learned**:

1. **Framework-specific tooling required**: Each framework (Astro, Svelte, Vue) has custom type-checkers
2. **Don't assume tsc covers everything**: Validate all file types in polyglot repos
3. **Test matrix should include apps**: Not just packages, but entry points users interact with
4. **Pre-push hooks are last defense**: If CI doesn't catch it, hooks prevent bad commits

---

## Category 8: Build Artifacts & Bundler Noise

### Limitation 8.1: Vite Warnings for Externalized Node.js Modules

**Worst Case**:

- Developer sees `[vite] Module "node:fs/promises" has been externalized` in CI logs
- Assumes something is broken or that a Node-only dependency leaked into the browser
- Spends hours trying to "fix" a warning that is actually handled by the architecture

**Why It Happens**:

1. **Sovereign Stratification**: Some packages in the monorepo are **Hybrid**. They contain both Node-compatible and Browser-compatible logic.
2. **Detection**: Vite's resolver scans all imports. Even if a package uses conditional exports (`"browser": "..."`), Vite may still warn if it encounters a Node.js built-in in a shared file or if the package hasn't fully migrated to a browser-specific entrypoint.
3. **JCO Transpilation**: Many of these references come from `jco` generated code which includes stubs for WASI that Vite (rightfully) externalizes in a browser context.
4. **Automatic Mitigation**: Refarm's `@refarm.dev/tractor` and other core packages use the `browser` export condition. Vite correctly maps these Node modules to empty modules/stubs, so no runtime error occurs.

**Mitigation**:

- **Status**: ✅ Documented as expected behavior.
- **Action**: Ignore these specific warnings for `@refarm.dev/*` packages unless accompanied by a runtime `ReferenceError: process is not defined` or similar.
- **Long-term**: Continue refining `index.browser.ts` entrypoints for all core packages to minimize bundler scan noise.

---

## Summary: What You Can Rely On Today

| Mitigation | Status | When |
|------------|--------|------|
| Schema evolution (upcasting) | ✅ Design ready (ADR-010) | v0.2.0 |
| CRDT conflict resolution | ✅ Working (Loro — ADR-045) | v0.1.0 |
| Conformance tests (contracts) | ✅ Working (12 tests) | v0.1.0 |
| Capability contracts | ✅ Working (4 packages) | v0.1.0 |
| **Graph versioning** | ⚠️ Design only (ADR-020) | v0.2.0-0.3.0 |
| **Self-healing** | ⚠️ Design only (ADR-021) | v0.3.0+ |
| **Plugin citizenship** | ⚠️ Design only (ADR-021) | v0.3.0+ |
| **Resource quota enforcement** | ❌ Not designed | v0.3.0+ |
| **License metadata** | ❌ Not designed | v0.2.0+ |

---

## How to Sleep Better Tonight

1. **You're asking the right questions** (quota exhaustion, plugin chaos, sync conflicts)
2. **You've designed solutions** (ADR-020, ADR-021 address most of these)
3. **You can't implement everything now** (that's OK, roadmap is explicit)
4. **You WILL find more problems** (that's expected, not failure)
5. **Foundation is solid** (offline-first, CRDT, contracts tested)

**Next Steps**:

- v0.1.1: Release contracts (proven foundation)
- v0.2.0: Implement 2-3 critical mitigations (graph versioning, observability)
- v0.3.0: Implement 2-3 more (self-healing, plugin citizenship)
- v1.0.0: All major limitations mitigated

**You don't need to solve everything before launching.**  
You need a **foundation that allows you to evolve** when you discover new problems.

You have that foundation.

---

## References

- [ADR-010: Schema Evolution](../specs/ADRs/ADR-010-schema-evolution.md)
- [ADR-020: Graph Versioning](../specs/ADRs/ADR-020-sovereign-graph-versioning.md)
- [ADR-021: Self-Healing](../specs/ADRs/ADR-021-self-healing-and-plugin-citizenship.md)
- [ADR-022: Policy Declarations](../specs/ADRs/ADR-022-policy-declarations-in-plugin-manifests.md) ← NEW
