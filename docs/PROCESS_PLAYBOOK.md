# Process Playbook

Interim operator guide for managing the Refarm factory processes until the CLI
abstracts these flows. Follow this when you need to start, stop, or diagnose
services by hand.

## Architecture overview

The factory runs **one backend at a time** on port 42000. Two backends exist:

| Backend  | Language | Ports                                         | Role                                            |
| -------- | -------- | --------------------------------------------- | ----------------------------------------------- |
| tractor  | Rust     | :42000 (WS)                                   | WASM plugin host, pi-agent, native CRDT sync    |
| farmhand | Node.js  | :42000 (WS CRDT sync) + :42001 (HTTP sidecar) | Task orchestration, file queue, effort dispatch |

**They share port 42000 and must not run at the same time.**

- Use **tractor** for interactive agent work (REPL, direct prompts, streaming).
- Use **farmhand** for batch task dispatch (effort queue, CI smoke, file transport).

---

## Quick reference

```bash
pnpm run farm:status        # unified status: both services, ports, artifacts, MODEL
refarm runtime              # selected runtime engine + autostart policy
refarm config set tractor.engine auto      # auto | rust | ts
refarm config set runtime.autostart ask    # ask | always | never
refarm telemetry           # runtime pressure snapshot (queue/in-flight/failures)
pnpm run refarm:telemetry:gate:ci      # strict fail-closed gate (recommended CI policy)
pnpm run refarm:telemetry:gate:strict-all  # enforce all diagnostics (hard mode)
# When checking remote CI results (after local validation):
gh run list --workflow test.yml --limit 5
gh run watch --exit-status
refarm agent install       # manual: force-install pi-agent (normally auto-installed on farmhand boot)
pnpm run agent:daemon       # start tractor in background
pnpm run agent:stop         # stop tractor
pnpm run farmhand:daemon    # start farmhand in background
pnpm run farmhand:stop      # stop farmhand
pnpm run disk:check         # disk usage: target dirs, node_modules, volumes
pnpm run actions:budget:guard:account      # hard Actions guard: monthly net billable quota
pnpm run actions:budget:guard:allocation   # advisory Actions guard: Refarm fairness split
pnpm run actions:budget:guard:modes:json   # discover hard/advisory guard metadata

# Session memory helpers (host-owned)
refarm sessions list        # list known sessions
refarm sessions new         # create and switch active session
refarm sessions fork <id>   # branch from an existing session
refarm sessions use <id>    # session helper to switch active session
refarm tree switch <id>     # timeline-first active-session switch
refarm tree list --json             # read-only session timeline nodes
refarm tree list --limit 5 --json   # bounded session timeline nodes
refarm tree list --scope git --json # read-only git timeline nodes
refarm tree preview <id>            # dry-run fork plan for a session node
refarm tree preview <id> --at <entry> # dry-run fork plan at a historical entry
refarm tree preview <id> --name <branch> # dry-run fork plan with explicit name
refarm tree preview --scope git <commit> # dry-run branch plan for a commit
refarm tree fork --scope git <commit> --name <branch> # create branch without switching
pnpm run refarm:actions:verify # closeout lane for action-readiness changes
pnpm run refarm:tree:verify # closeout lane for tree stabilization changes
```

---

## CLI runtime controls

`refarm` now owns the daily-driver runtime selection path. Use the manual
`pnpm run agent:*` and `pnpm run farmhand:*` commands below when you are
debugging the backends directly.

```bash
refarm runtime                         # show configured/active engine
refarm runtime --json                  # machine-readable runtime status
refarm config set tractor.engine auto  # prefer Rust tractor, fall back to TS farmhand
refarm config set tractor.engine rust  # require Rust tractor; fail early if missing
refarm config set tractor.engine ts    # force TypeScript farmhand
refarm config set runtime.autostart always  # ask | always | never
```

`runtime.autostart` is the canonical autostart key for CLI flows. The legacy
`farmhand.autostart` key still reads and writes the same stored value for
compatibility. `REFARM_RUNTIME_AUTOSTART` is the preferred environment override;
`REFARM_FARMHAND_AUTOSTART` remains a legacy fallback.

---

## Tractor (agent backend)

### Start

```bash
pnpm run agent:daemon       # background — writes .refarm/tractor.pid + tractor.log
pnpm run agent:start        # foreground — no PID file, Ctrl+C to stop
```

Prerequisites: tractor binary must exist.

```bash
# Build (once, or after Rust changes):
cd packages/tractor && cargo build --release
# Outputs to $CARGO_TARGET_DIR/release/tractor (devcontainer volume)
```

### Stop

```bash
pnpm run agent:stop         # SIGTERM via .refarm/tractor.pid
# Or kill directly:
kill $(cat .refarm/tractor.pid)
```

### Logs

```bash
tail -f .refarm/tractor.log     # background mode only
```

### Check

```bash
pnpm run farm:status
# tractor section shows: pid, WS probe result, binary age
```

---

## Farmhand (task orchestration daemon)

### Start

```bash
pnpm run farmhand:daemon    # background — writes .refarm/farmhand.pid + farmhand.log
pnpm run farmhand:start     # foreground — no PID file, Ctrl+C to stop
```

No build step required — runs from source via Node type-stripping with the Farmhand resolver loader (`scripts/farmhand-node-loader.mjs`).

### Stop

```bash
pnpm run farmhand:stop      # SIGTERM via .refarm/farmhand.pid
```

### Logs

```bash
tail -f .refarm/farmhand.log    # background mode only
```

### Check

```bash
pnpm run farm:status
# farmhand section shows: pid, HTTP sidecar probe, task queue depth

# Direct HTTP probe:
curl -s http://127.0.0.1:42001/efforts/summary | node -e "process.stdin|>JSON.parse|>console.log"
```

---

## Common scenarios

### Scenario 1 — Start fresh for interactive agent work

```bash
pnpm run farm:status        # verify nothing is running
pnpm run agent:daemon       # start tractor
pnpm run agent:repl         # start REPL
# When done:
pnpm run agent:stop
```

### Scenario 2 — Run a task smoke test

```bash
pnpm run farm:status        # verify nothing is running on :42001
# Tests start their own farmhand stub on :42001; a running farmhand will conflict.
pnpm run task:execution:smoke
# Or:
pnpm run task:execution:smoke:pi-agent
```

If farmhand is already running, stop it first:

```bash
pnpm run farmhand:stop && pnpm run task:execution:smoke
```

### Scenario 3 — Farmhand for agent task dispatch (batch)

```bash
pnpm run farm:status        # verify tractor is not running
pnpm run farmhand:daemon    # starts :42000 (WS) + :42001 (HTTP)
# Dispatch efforts via HTTP:
curl -X POST http://127.0.0.1:42001/efforts -H 'Content-Type: application/json' \
  -d '{"task": {...}, "effort": {...}}'
# Check queue:
curl -s http://127.0.0.1:42001/efforts/summary
# Check rolling pressure window:
curl -s 'http://127.0.0.1:42001/telemetry/window?minutes=30'
pnpm run farm:status
# Stop:
pnpm run farmhand:stop
```

### Scenario 3b — Canonical local ask flow (daily driver)

```bash
pnpm run farmhand:daemon    # farmhand auto-installs pi-agent on boot
refarm ask "o que é CRDT?"
```

Notes:
- Farmhand auto-installs pi-agent from the bundled npm package when it boots.
  To manually trigger: `refarm agent install`.
- `refarm ask ...` works with the built-in resolver loader.
- Use `refarm telemetry --profile balanced` (or conservative/throughput) to
  watch queue/in-flight pressure and recent failure-rate signals.
- Use `refarm telemetry --strict` to fail-closed when diagnostics are present
  (automation/CI-friendly exit code 2).
- For automation wrappers that can bootstrap farmhand when needed, use
  `pnpm run refarm:telemetry:gate:ci`.
- To persist gate output artifacts for trend analysis, add
  `--out .artifacts/telemetry/gate-latest.json`.
- Signal meanings + first-response actions live in
  `docs/REFARM_TELEMETRY_RUNBOOK.md`.

### Scenario 3c — Session-first workflow

```bash
refarm sessions new --name "auth-refactor"
refarm ask "planeje os próximos passos"
refarm sessions fork <id-prefix> --name "auth-refactor-alt"
refarm tree preview <id-prefix> --switch
refarm tree switch <id-prefix>
refarm ask --session <id-prefix> "continue deste branch"
```

Use this when exploring multiple solution branches without losing continuity.
`--session` pins a request to a specific session without switching first. Use
`refarm ask --new "..."` when you explicitly want a fresh conversation: the CLI
clears the active pointer, allocates a new session ID, submits the ask with that
fresh ID, and persists the same ID only after a successful stream or fallback
result. Active-session pointer writes are verified through the shared
`session-lock.ts` helper. The longer-term substrate-agnostic design lives in
[Refarm Tree Primitive](./REFARM_TREE_PRIMITIVE.md).

### Scenario 3d — Timeline-first tree workflow

Use `refarm tree` when you want renderer-neutral inspection and dry-run readiness
before moving state:

```bash
refarm tree list --scope all
refarm tree list --scope session
refarm tree preview <session-id-prefix> --switch
refarm tree switch <session-id-prefix>

refarm tree list --scope git --limit 5
refarm tree preview --scope git HEAD --name experiment/refactor
refarm tree fork --scope git HEAD --name experiment/refactor
refarm tree preview --scope git experiment/refactor --switch
refarm tree switch --scope git experiment/refactor
```

Preview commands are non-mutating. Blocked-but-resolvable previews should return
operator-readable readiness (`Blocked: ...`) and, for JSON output,
`readyToExecute: false`. Execution remains explicit via `tree fork` or
`tree switch`. After changing tree contracts or adapter boundaries, run
`pnpm run refarm:tree:verify` before considering the tree slice closed.

### Scenario 4 — Port conflict at startup

```bash
pnpm run agent:daemon
# ❌  Port 42000 is already bound by PID 4567.
pnpm run farm:status        # identify what's on :42000
pnpm run farmhand:stop      # if farmhand is the culprit
# or:
pnpm run agent:stop         # if a stale tractor is the culprit
# Then retry:
pnpm run agent:daemon
```

### Scenario 5 — Run pi-agent harness tests

The harness starts its own mock MODEL on a random port — no service conflict possible.
It does NOT require tractor or farmhand to be running.

```bash
# Build WASM first (outputs to $CARGO_TARGET_DIR):
cd packages/pi-agent && cargo component build --release
# Run harness (serialize with --test-threads=1):
cd packages/tractor && cargo test --test pi_agent_harness -- --ignored --test-threads=1
```

If you want to also keep tractor running for interactive work:
the harness uses an in-memory NativeSync (`:memory:`) — no port conflict.

### Scenario 6 — After disk cleanup, rebuild binaries

After running `pnpm run clean:heavy` or when `CARGO_TARGET_DIR` volume is empty:

```bash
# Rebuild tractor binary:
cd packages/tractor && cargo build --release
# Rebuild pi-agent WASM:
cd packages/pi-agent && cargo component build --release
# Verify:
pnpm run farm:status        # check ARTIFACTS section
```

---

## Port assignments

| Port  | Protocol  | Role                            | Conflict if…                          |
| ----- | --------- | ------------------------------- | ------------------------------------- |
| 42000 | WebSocket | CRDT sync (tractor OR farmhand) | Both backends running simultaneously  |
| 42001 | HTTP      | farmhand HTTP sidecar           | farmhand + CI smoke stub both running |
| :0    | HTTP      | mock MODEL (harness tests)        | OS-assigned — no conflict possible    |

---

## State files in `.refarm/`

```
.refarm/
  tractor.pid      # tractor background PID (created by pnpm run agent:daemon)
  tractor.log      # tractor stdout/stderr (background mode)
  farmhand.pid     # farmhand background PID (created by pnpm run farmhand:daemon)
  farmhand.log     # farmhand stdout/stderr (background mode)
  .env             # MODEL API keys (pnpm run agent:keys to configure)
  config.json      # model provider, model, budgets, FS restrictions
  .repl_history    # REPL command history
  tasks/           # FileTransport input queue (farmhand)
  task-results/    # effort outcomes
  task-logs/       # effort NDJSON logs
  task-control/    # retry/cancel signals
  streams/         # stream chunk files
  plugins/         # installed plugin manifests + WASM blobs
    pi-agent/
      plugin.json
      pi-agent.wasm
```

All `.refarm/` contents are gitignored.

---

## Diagnostic checklist

When something is wrong, work top-down:

1. **`pnpm run farm:status`** — start here. Read every section.
2. **Port conflict?** — `ss -tlnp | grep '42000\|42001'` — identify the PID.
3. **Stale PID file?** — process dead but PID file exists → `rm .refarm/*.pid` then retry.
4. **Binary missing?** — ARTIFACTS section in farm:status will tell you what to build.
5. **No API keys?** — MODEL section in farm:status → `pnpm run agent:keys`.
6. **Disk full?** — `pnpm run disk:check` → `pnpm run clean:light` or `pnpm run clean:heavy`.
7. **WASM/harness fails?** — ensure `$CARGO_TARGET_DIR` is set and pi_agent.wasm is at
   `$CARGO_TARGET_DIR/wasm32-wasip1/release/pi_agent.wasm`.

---

## Long-term direction

This playbook is an interim measure. The `apps/refarm` CLI is evolving to
abstract daemon lifecycle, runtime selection, task dispatch, and status into
first-class commands. `refarm runtime`, `refarm status`, and `refarm ask`
already cover the daily-driver path; use this doc and `pnpm run farm:status`
when you need lower-level backend diagnostics.
