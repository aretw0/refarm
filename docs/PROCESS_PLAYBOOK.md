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
npm run farm:status        # unified status: both services, ports, artifacts, LLM
refarm telemetry           # runtime pressure snapshot (queue/in-flight/failures)
npm run agent:install      # install pi-agent plugin + local refarm shim (~/.local/bin/refarm)
npm run agent:daemon       # start tractor in background
npm run agent:stop         # stop tractor
npm run farmhand:daemon    # start farmhand in background
npm run farmhand:stop      # stop farmhand
npm run disk:check         # disk usage: target dirs, node_modules, volumes

# Session memory helpers (host-owned)
refarm sessions list        # list known sessions
refarm sessions new         # create and switch active session
refarm sessions fork <id>   # branch from an existing session
refarm sessions use <id>    # switch active session
```

---

## Tractor (agent backend)

### Start

```bash
npm run agent:daemon       # background — writes .refarm/tractor.pid + tractor.log
npm run agent:start        # foreground — no PID file, Ctrl+C to stop
```

Prerequisites: tractor binary must exist.

```bash
# Build (once, or after Rust changes):
cd packages/tractor && cargo build --release
# Outputs to $CARGO_TARGET_DIR/release/tractor (devcontainer volume)
```

### Stop

```bash
npm run agent:stop         # SIGTERM via .refarm/tractor.pid
# Or kill directly:
kill $(cat .refarm/tractor.pid)
```

### Logs

```bash
tail -f .refarm/tractor.log     # background mode only
```

### Check

```bash
npm run farm:status
# tractor section shows: pid, WS probe result, binary age
```

---

## Farmhand (task orchestration daemon)

### Start

```bash
npm run farmhand:daemon    # background — writes .refarm/farmhand.pid + farmhand.log
npm run farmhand:start     # foreground — no PID file, Ctrl+C to stop
```

No build step required — runs from source via Node type-stripping with the Farmhand resolver loader (`scripts/farmhand-node-loader.mjs`).

### Stop

```bash
npm run farmhand:stop      # SIGTERM via .refarm/farmhand.pid
```

### Logs

```bash
tail -f .refarm/farmhand.log    # background mode only
```

### Check

```bash
npm run farm:status
# farmhand section shows: pid, HTTP sidecar probe, task queue depth

# Direct HTTP probe:
curl -s http://127.0.0.1:42001/efforts/summary | node -e "process.stdin|>JSON.parse|>console.log"
```

---

## Common scenarios

### Scenario 1 — Start fresh for interactive agent work

```bash
npm run farm:status        # verify nothing is running
npm run agent:daemon       # start tractor
npm run agent:repl         # start REPL
# When done:
npm run agent:stop
```

### Scenario 2 — Run a task smoke test

```bash
npm run farm:status        # verify nothing is running on :42001
# Tests start their own farmhand stub on :42001; a running farmhand will conflict.
npm run task:execution:smoke
# Or:
npm run task:execution:smoke:pi-agent
```

If farmhand is already running, stop it first:

```bash
npm run farmhand:stop && npm run task:execution:smoke
```

### Scenario 3 — Farmhand for agent task dispatch (batch)

```bash
npm run farm:status        # verify tractor is not running
npm run farmhand:daemon    # starts :42000 (WS) + :42001 (HTTP)
# Dispatch efforts via HTTP:
curl -X POST http://127.0.0.1:42001/efforts -H 'Content-Type: application/json' \
  -d '{"task": {...}, "effort": {...}}'
# Check queue:
curl -s http://127.0.0.1:42001/efforts/summary
# Check rolling pressure window:
curl -s 'http://127.0.0.1:42001/telemetry/window?minutes=30'
npm run farm:status
# Stop:
npm run farmhand:stop
```

### Scenario 3b — Canonical local ask flow (daily driver)

```bash
npm run agent:install      # refresh plugin + ensure 'refarm' command shim
npm run farmhand:daemon
refarm ask "o que é CRDT?"
```

Notes:
- `agent:install` now installs `~/.local/bin/refarm` wrapper that launches
  `apps/refarm/dist` with the local resolver loader, so `refarm ask ...` works
  without manual node flags.
- If `~/.local/bin` is not in PATH, add it before using `refarm` directly.
- Use `refarm telemetry --profile balanced` (or conservative/throughput) to
  watch queue/in-flight pressure and recent failure-rate signals.

### Scenario 3c — Session-first workflow

```bash
refarm sessions new --name "auth-refactor"
refarm ask "planeje os próximos passos"
refarm sessions fork <id-prefix> --name "auth-refactor-alt"
refarm sessions use <id-prefix>
refarm ask --session <session-id> "continue deste branch"
```

Use this when exploring multiple solution branches without losing continuity.
`--session` pins a request to a specific session without switching first.

### Scenario 4 — Port conflict at startup

```bash
npm run agent:daemon
# ❌  Port 42000 is already bound by PID 4567.
npm run farm:status        # identify what's on :42000
npm run farmhand:stop      # if farmhand is the culprit
# or:
npm run agent:stop         # if a stale tractor is the culprit
# Then retry:
npm run agent:daemon
```

### Scenario 5 — Run pi-agent harness tests

The harness starts its own mock LLM on a random port — no service conflict possible.
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

After running `npm run clean:heavy` or when `CARGO_TARGET_DIR` volume is empty:

```bash
# Rebuild tractor binary:
cd packages/tractor && cargo build --release
# Rebuild pi-agent WASM:
cd packages/pi-agent && cargo component build --release
# Verify:
npm run farm:status        # check ARTIFACTS section
```

---

## Port assignments

| Port  | Protocol  | Role                            | Conflict if…                          |
| ----- | --------- | ------------------------------- | ------------------------------------- |
| 42000 | WebSocket | CRDT sync (tractor OR farmhand) | Both backends running simultaneously  |
| 42001 | HTTP      | farmhand HTTP sidecar           | farmhand + CI smoke stub both running |
| :0    | HTTP      | mock LLM (harness tests)        | OS-assigned — no conflict possible    |

---

## State files in `.refarm/`

```
.refarm/
  tractor.pid      # tractor background PID (created by npm run agent:daemon)
  tractor.log      # tractor stdout/stderr (background mode)
  farmhand.pid     # farmhand background PID (created by npm run farmhand:daemon)
  farmhand.log     # farmhand stdout/stderr (background mode)
  .env             # LLM API keys (npm run agent:keys to configure)
  config.json      # LLM provider, model, budgets, FS restrictions
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

1. **`npm run farm:status`** — start here. Read every section.
2. **Port conflict?** — `ss -tlnp | grep '42000\|42001'` — identify the PID.
3. **Stale PID file?** — process dead but PID file exists → `rm .refarm/*.pid` then retry.
4. **Binary missing?** — ARTIFACTS section in farm:status will tell you what to build.
5. **No API keys?** — LLM section in farm:status → `npm run agent:keys`.
6. **Disk full?** — `npm run disk:check` → `npm run clean:light` or `npm run clean:heavy`.
7. **WASM/harness fails?** — ensure `$CARGO_TARGET_DIR` is set and pi_agent.wasm is at
   `$CARGO_TARGET_DIR/wasm32-wasip1/release/pi_agent.wasm`.

---

## Long-term direction

This playbook is an interim measure. The `apps/refarm` CLI (`refarm-task`, etc.) is
evolving to abstract daemon lifecycle, task dispatch, and status into first-class
commands. When those ship, the manual steps above become `refarm start`, `refarm stop`,
and `refarm status`. Until then, this doc and `npm run farm:status` are the canonical
operator interface.
