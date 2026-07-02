# Commons Watchdog Implementation Plan (ADR-078 Phase 8, promoted)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** A userspace commons watchdog that protects the **control plane** — when environment pressure is critical, it reclaims the heaviest **workload** process (cargo/vitest/turbo/pnpm), sparing agent/refarm runtimes, so a controller survives the workloads it launches. **No cgroup delegation required.**

**Architecture:** A small Node daemon (launched in the background by `.devcontainer/post-start.sh`) that loops: reads `buildEnvironmentPressureReport()` from `@refarm.dev/health`; on `stop-and-investigate`, lists `/proc` by RSS, classifies by cmdline, TERM/KILLs the heaviest workload; emits a provenance record to the same `TelemetryBus` Scarecrow uses; never kills control (escalates instead).

**Why this over cgroup sub-slices (ADR-078 Phase 4-5):** in-container cgroup v2 delegation is often denied without `--privileged` (the ADR marks the "root/entrypoint lane" pending). The watchdog achieves the same end — *kill the workload, not the controller* — in userspace, reusing `@refarm.dev/health`, testable, environment-agnostic. Sub-slices remain a precision refinement, conditional on a delegation spike.

## Global Constraints

- Reuses `@refarm.dev/health` (`buildEnvironmentPressureReport`) — no new authority (ADR-078 Boundary).
- Emits to the existing `TelemetryBus` (event `environment:watchdog:reclaim`) — one observability trail with Scarecrow (which is observation-only today; enforcement is future).
- **Never kills a `control` process** (agents/refarm); if only control is under pressure, **escalate**, do not kill.
- Linux `/proc` for process listing; `process.kill` for reclamation.

## The layered thesis (context)

The OOM/fork-storm lives in the **native-process layer** — outside the WASM sandbox (Scarecrow observes tool-call *events*, not the spawned native process's resource growth) and not plane-separated (no sub-slices). So: Scarecrow observes intent; the cgroup ceiling (Phase 3, active on rebuild) caps the box; **this watchdog reclaims the native process** — the layer the others do not cover.

---

### Task 1: Classification + target selection (pure, TDD)

**Files:** Create `scripts/devcontainer/commons-watchdog.mjs`, `scripts/devcontainer/commons-watchdog.test.mjs`.

**Interfaces:** Produces `classifyProcess(cmdline) => "control"|"workload"|"unknown"`, `selectWatchdogTarget(procs) => proc|null`.

- [ ] **Step 1: Write the failing test**

```js
import { test, expect } from "vitest";
import { classifyProcess, selectWatchdogTarget } from "./commons-watchdog.mjs";

test("classifies workload vs control vs unknown by cmdline", () => {
  expect(classifyProcess("node .bin/vitest run")).toBe("workload");
  expect(classifyProcess("cargo build --release")).toBe("workload");
  expect(classifyProcess("pnpm install")).toBe("workload");
  expect(classifyProcess("/usr/bin/refarm daemon")).toBe("control");
  expect(classifyProcess("bash")).toBe("unknown");
});

test("selects the heaviest WORKLOAD, sparing control", () => {
  const procs = [
    { pid: 10, rssMiB: 3000, cmdline: "cargo build" },
    { pid: 11, rssMiB: 3500, cmdline: "refarm daemon" },
    { pid: 12, rssMiB: 900, cmdline: "vitest run" },
  ];
  expect(selectWatchdogTarget(procs)?.pid).toBe(10);
});

test("returns null when nothing is workload", () => {
  expect(selectWatchdogTarget([{ pid: 11, rssMiB: 3500, cmdline: "refarm daemon" }])).toBeNull();
});
```

- [ ] **Step 2: Run — expect FAIL** (`pnpm -C . vitest run scripts/devcontainer/commons-watchdog.test.mjs`, or the repo's runner).

- [ ] **Step 3: Implement**

```js
// scripts/devcontainer/commons-watchdog.mjs
const WORKLOAD_PATTERNS = [/\bcargo\b/, /\bvitest\b/, /\bturbo\b/, /\bpnpm\b/, /\btsc\b/, /\besbuild\b/, /node\b.*--test/];
const CONTROL_PATTERNS = [/\brefarm\b/, /\bcodex\b/, /\bclaude\b/, /\bfarmhand\b/, /\bagent\b/];

export function classifyProcess(cmdline) {
  if (CONTROL_PATTERNS.some((re) => re.test(cmdline))) return "control";
  if (WORKLOAD_PATTERNS.some((re) => re.test(cmdline))) return "workload";
  return "unknown";
}

export function selectWatchdogTarget(procs) {
  return procs.filter((p) => classifyProcess(p.cmdline) === "workload").sort((a, b) => b.rssMiB - a.rssMiB)[0] ?? null;
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(watchdog): process classification + target selection`.

---

### Task 2: Pressure-gated tick (injectable, TDD — no real kill)

**Files:** append to both files.

**Interfaces:** Produces `watchdogTick({ report, listProcs, kill, log, escalate }) => { acted, target?, escalated? }`.

- [ ] **Step 1: Write the failing test**

```js
import { watchdogTick } from "./commons-watchdog.mjs";
const procs = [{ pid: 10, rssMiB: 3000, cmdline: "cargo build" }, { pid: 11, rssMiB: 3500, cmdline: "refarm daemon" }];

test("kills the heaviest workload on stop-and-investigate", async () => {
  const killed = [];
  const r = await watchdogTick({ report: { decision: "stop-and-investigate" }, listProcs: () => procs, kill: (p) => killed.push(p), log: () => {}, escalate: () => {} });
  expect(killed).toEqual([10]); expect(r.acted).toBe(true);
});
test("does nothing when decision is continue", async () => {
  const killed = [];
  await watchdogTick({ report: { decision: "continue" }, listProcs: () => procs, kill: (p) => killed.push(p), log: () => {}, escalate: () => {} });
  expect(killed).toEqual([]);
});
test("escalates (never kills control) when only control is under pressure", async () => {
  const killed = []; let escalated = false;
  await watchdogTick({ report: { decision: "stop-and-investigate" }, listProcs: () => [{ pid: 11, rssMiB: 3500, cmdline: "refarm daemon" }], kill: (p) => killed.push(p), log: () => {}, escalate: () => { escalated = true; } });
  expect(killed).toEqual([]); expect(escalated).toBe(true);
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement**

```js
export async function watchdogTick({ report, listProcs, kill, log, escalate }) {
  if (report.decision !== "stop-and-investigate") return { acted: false };
  const target = selectWatchdogTarget(listProcs());
  if (!target) { escalate({ event: "environment:watchdog:escalate", reason: "critical pressure, no workload to reclaim" }); return { acted: false, escalated: true }; }
  log({ event: "environment:watchdog:reclaim", pid: target.pid, rssMiB: target.rssMiB, cmdline: target.cmdline, decision: report.decision, at: new Date().toISOString() });
  kill(target.pid);
  return { acted: true, target };
}
```

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(watchdog): pressure-gated tick with control-plane safeguard`.

---

### Task 3: Daemon glue + boot wiring + telemetry

**Files:** append to `commons-watchdog.mjs`; edit `.devcontainer/post-start.sh`.

- [ ] **Step 1: /proc lister, escalating kill, loop, TelemetryBus emit**

```js
import { readdirSync, readFileSync } from "node:fs";
import { buildEnvironmentPressureReport } from "@refarm.dev/health";

function listProcs() {
  const out = [];
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`).toString().replace(/\0/g, " ").trim();
      if (!cmdline) continue;
      const rssPages = Number(readFileSync(`/proc/${pid}/statm`, "utf8").split(" ")[1]);
      out.push({ pid: Number(pid), rssMiB: (rssPages * 4096) / (1024 * 1024), cmdline });
    } catch { /* proc gone */ }
  }
  return out;
}
function killEscalating(pid) {
  try { process.kill(pid, "SIGTERM"); } catch {}
  setTimeout(() => { try { process.kill(pid, "SIGKILL"); } catch {} }, 3000);
}
async function main() {
  const intervalMs = Number(process.env.REFARM_WATCHDOG_INTERVAL_MS ?? 5000);
  const log = (e) => console.error(`[commons-watchdog] ${JSON.stringify(e)}`); // route to TelemetryBus when wired
  setInterval(async () => {
    try { await watchdogTick({ report: buildEnvironmentPressureReport(), listProcs, kill: killEscalating, log, escalate: log }); }
    catch (err) { log({ event: "environment:watchdog:error", error: String(err) }); }
  }, intervalMs);
  log({ event: "environment:watchdog:start", intervalMs });
}
if (process.argv[1]?.endsWith("commons-watchdog.mjs")) main();
```

- [ ] **Step 2: `.devcontainer/post-start.sh`** — launch once, guarded by a lockfile:
  `nohup node "$ROOT/scripts/devcontainer/commons-watchdog.mjs" >/tmp/commons-watchdog.log 2>&1 &`

- [ ] **Step 3: Route `log`/`escalate` to the real `TelemetryBus`** (the same bus Scarecrow's `agent-tool:*` events use) so environment reclamation shares Scarecrow's observability trail.

- [ ] **Step 4: Commit** `feat(watchdog): /proc lister + escalating kill + boot wiring + telemetry`.

---

## Safeguards (design, not optional)

- **Never kills `control`** — classification excludes agents/refarm; if pressure is only control, **escalate**.
- **Auditable provenance** on every reclaim (pid/rss/cmdline/decision/timestamp) via `TelemetryBus` — one trail with Scarecrow.
- **Optional exact marker:** heavy lanes export `REFARM_LANE=workload`; read `/proc/<pid>/environ` for exact classification when cmdline is ambiguous.
- **Idempotent at boot** (lockfile).

## Relationship to Scarecrow (corrected)

Scarecrow = host-side **observer** of the runtime's tool calls (`agent-fs`/`agent-shell` → `TelemetryBus`, Step 3 done). It is **observation, not enforcement** today (policy = deferred Step 4). It sees the `shell:spawn` *event*, not the spawned native process's resource growth. The watchdog covers that blind layer. They **share telemetry, not authority**.
