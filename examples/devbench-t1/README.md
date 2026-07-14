# devbench-t1 — the developer's extension bench (T1)

A per-work POC app: its own CLI (`dgk`). Presented in
**process mode** — the opposite of T2/T3. Instead of hiding the machine behind a
finished product, devbench **shows the machine being extended**: an extension declares
itself and its verbs surface by themselves. The angle is technical and general —
"declare once → it appears everywhere".
Set `DGK_COMMAND` to white-label the command when needed.

## What it demonstrates

Extending the platform the platform way — not importing a package, but declaring an extension
that multi-surfaces:

```bash
dgk extension                # what the coding-agent extension declares, and how it surfaces
dgk actions --json           # extension + plugin verb action rows for every surface
dgk agent-code prompt='...'  # a verb that came from the manifest, not from app code
dgk agent-review             # ditto — surfaced by the bridge, dispatched to the plugin
dgk serve                    # the surfaced verbs on a web surface too
# GET /docs/openapi.json     # white-label capability spec for tools such as Swagger
```

`src/persona.ts` declares a **plugin manifest** for a coding-agent
(`provides: ["agent:code", "agent:review"]`). The bridge (`registerPluginCapabilities`)
synthesizes a first-class verb per declared entry, with a host-built dispatch `run()`
the developer never writes. `extension` makes the mechanism visible: declaration →
surfaced verbs, while `actions` projects the inspector and the plugin verbs into
selectable surface rows. This is the extension effect — an installed extension appearing
on every surface by itself. The bridge uses scoped names (`agent-code`, `agent-review`)
so several plugins can declare the same verb, like `vault:search` and `web:search`,
without registration-order ambiguity. Short aliases such as `code` are persona choices,
not bridge defaults.

## Two layers

- **Generic (platform, unchanged):** the neutral `source` / `records` / `vault` chain
  **plus** the extension path (manifest → bridge → multi-surface).
- **Specific (this app):** the coding-agent manifest + the inspector verb. In a real
  deployment the agent is a WASM plugin the developer builds and installs; here the
  manifest is inline, but dispatch still goes through a platform-compatible sidecar so
  the example dogfoods the daemon path.

## Governance, executed — and runtime tinkering

The governance quartet is not asserted, it is EXECUTED on the Rust runtime:

```bash
dgk governance-poc           # DECIDE — grant/deny/review, risk-tiered policy (decideCapabilityGrants)
dgk governance-audit --mock  # RECORD — the host's tamper-evidence trail of the effects that ran
dgk governance-enforce       # ENFORCE — the host REFUSES an undeclared effect at the sandbox boundary
dgk plugin-reload            # RUNTIME TINKERING — hot-reload a plugin without restarting the host
dgk delegate-run "…" --chain # a scout→planner→worker pipeline: one extension orchestrating sub-agents
dgk agent-telemetry --mock   # OBSERVABILITY — the run's timeline: route, iterations, tool calls, tokens
dgk plugin-resilience        # RESILIENCE — a runaway plugin is trapped + respawned; the host keeps serving
```

`plugin-resilience` proves a bad extension does not bring the machine down: it boots the agent
beside a crash-plugin whose `on_event` spins forever, dispatches the runaway event, and the host
traps the store under its epoch budget, respawns a fresh instance, and still serves — the agent
responds after the crash. The sovereign machine isolates a misbehaving extension.

`agent-telemetry` makes a run legible: it reads the agent's own `agent:*` lifecycle events from
the audit trail and projects the timeline — which model was routed and WHY (the ADR-012 audit),
each react-loop iteration, each tool call, and the final tokens. The reusable core
(`parseAgentTimeline`) is pure and unit-tested offline; the verb proves it live. It is honest about
the runtime: events correlate by the run's `prompt_ref` (not effortId), and USD cost is not an
event — only tokens (real when the model reports usage).

`governance-enforce` is the third face the quartet was missing: it boots the SAME agent under
`securityMode: "strict"` with `fs:read` dropped from its manifest, scripts a read, and shows NO
`host-effect:fs:read` line reached the audit trail — the host's `enforce_permission` denied the
effect before it ran — contrasted with a granted baseline that DOES produce one. Same plugin, same
read, two grant postures: governance is not a parecer, the host **recuses** the effect.
`plugin-reload` hot-swaps a plugin's code via `POST /plugins/reload` (`TractorNative::reload_plugin`)
and proves the host stayed up (the agent dispatches again after) — the developer editing an
extension live, the machine never coming down. `delegate-run --chain` runs the delegate plugin's
multi-level pipeline (each persona refines the previous step's output), all sandboxed. Each of
these is proven live in a `*.execution.test.ts` gated on `RUN_RUNTIME_EXECUTION=1`.

## Run it

```bash
pnpm --filter devbench-t1 build
pnpm --filter devbench-t1 dgk extension
pnpm --filter devbench-t1 dgk actions --json
pnpm --filter devbench-t1 dgk --help    # agent-code / agent-review beside neutral verbs
```

Set `DGK_DEVBENCH_SIDECAR_URL` to point this example at its isolated demo runtime.
If unset, `dgk` targets `http://127.0.0.1:42123`.
Set `DGK_COMMAND=/path/to/cli-name` to change the CLI command root (for example
`DGK_COMMAND=devbench-acme`).

## White-label to the core — one brand, every layer

devbench runs under its OWN brand (`DGK`), and that brand reaches every layer of
the shared substrate — nothing is nailed to "refarm":

- **Command**: `DGK_COMMAND` overrides the CLI name. The generic
  `@refarm.dev/capability-host` derives the override env from the command itself
  (`dgk` → `DGK_COMMAND`), so it names no brand (ADR-087).
- **Runtime**: `DGK_DEVBENCH_SIDECAR_URL` points at devbench's own daemon.
- **Config**: the SHARED `@refarm.dev/config` resolves devbench's env under the
  `DGK` prefix — `DGK_SITE_URL`, `DGK_SCOPE_*`, `DGK_PROVIDER_*` feed the
  brand/providers tree, and a stray upstream `REFARM_*` is ignored. Pick the
  prefix once via the neutral selector (`SOVEREIGN_ENV_PREFIX=DGK`) or per call
  (`loadConfig(root, { envPrefix: "DGK" })`).

`src/white-label-config.test.ts` proves this end-to-end from the consumer side: a
white-label app drives the shared config with zero refarm leak. This is the point
of a genuine T1 consumer — it exercises the substrate's white-label seams for
real, and reveals anything still tied to the upstream brand.

## Focus — what T1 makes shine (survives our design conversation)

**Persona & mode.** The developer; **process mode** — show the MACHINE being extended,
not a finished product. T1 is technical and general: "declare once → it appears
everywhere."

**The scenario to record.** Show the developer:
1. **Installing the coding-agent locally** — the coding-agent is a plugin that already
   exists (`packages/agent`); T1 demonstrates installing it, not building it.
2. **Developing a NEW extension** live — declaring it, watching it surface across CLI /
   TUI / web from one declaration (the extension effect, `dgk extension` makes it visible).
   The verb comes in via a plugin manifest, dispatched over the WASM boundary — no
   hand-written run().

**The easter egg (hidden continuity T1 → T3).** The extension developed here is —
without saying so — the one **T3 uses**. Pick something T3 consumes (e.g. a requirements
renderer / an enrichment provider). Copy/paste between examples is fine. Nobody states
the link; someone viewing all three side by side notices T1 created what T3 consumes. T3
uses it as if it already existed.

**What to build for a rich demo.**
- The coding-agent installed + driven (a real dev task, even scoped).
- The new extension built via the platform extension path (manifest → multi-surface),
  ideally the very source/enrichment/renderer WASM provider T3 then loads.
- The surfaces (CLI + TUI + web) showing the same verb, proving "declare once".

**What stays generic (platform) vs specific (here).** The platform ships the neutral chain +
the extension path + the CLI/TUI/web surfaces. This app supplies the dev scenario and
the easter-egg extension. Swap the scenario, keep the machine.
