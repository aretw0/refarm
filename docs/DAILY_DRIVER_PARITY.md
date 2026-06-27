# Daily-Driver Parity Checklist

Refarm reaches `v0.1.0` only when it can replace the creator's current external pi workflow for real work. This checklist translates that policy into observable capabilities.

Reference driver research is tracked in
[`docs/REFERENCE_AGENT_DRIVER_RESEARCH.md`](REFERENCE_AGENT_DRIVER_RESEARCH.md).
Codex, Claude Code, Hermes Agent, and Pi converge on the same product pressure:
hard lifecycle policy, progressive capabilities, durable memory, resumable
sessions, bounded worker delegation, and scheduled/headless work. This checklist
remains the gate: a reference pattern only matters after Refarm can prove it
locally.

## Minimum daily loop

| Capability                | Refarm surface                              | Local validation signal                                                                                                                         | Status |
| ------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Start a work session      | `tractor` daemon + `apps/me` shell          | daemon boots, `apps/me` connects to `ws://localhost:42000`                                                                                      | ⬜     |
| Ask an agent to reason    | Runtime agent hosted by Tractor             | `refarm ask` assembles the runtime-agent effort and follows stream chunks locally; live daily-driver Tractor/runtime-agent path pending           | local proven / live path pending |
| See live output           | UI consumer of Tractor observations         | Homestead renders generic stream observations locally; real Tractor/apps-me E2E pending                                                         | local proven / E2E pending |
| Use local tools           | Runtime-agent tool dispatch through host bridges | filesystem/code/search tools are exposed through WASM host capabilities, policy-gated, and auditable; live policy bundle pending                 | local proven / policy pending |
| Preserve memory           | `.project/` blocks + Loro/SQLite graph      | Loro/SQLite graph stores, snapshots, syncs, and reopens local nodes; app/daemon restart proof pending                                           | storage restart proven / app restart pending |
| Resume after interruption | handoff + project status                    | `refarm resume --json` recovers non-terminal task checkpoints, reads `.project/handoff.json`, and hands off to `refarm task resume --json`; live project-state policy pending | checkpoint + project handoff proven / policy pending |
| Work offline              | `apps/me` + OPFS + service worker           | edit while Tractor is offline, reconnect, and deliver delta                                                                                     | ⬜     |
| Recover from failure      | SQLite/OPFS backup path                     | restore from backup without graph corruption or lost tasks                                                                                      | ⬜     |
| Automate reminders        | Windmill/scheduler equivalent               | one-shot and recurring reminders run locally with clear ownership                                                                               | ⬜     |
| Govern resource use       | disk + quota + local validation policy      | scoped checks run before CI; cleanup frees derived artifacts without source loss                                                                | ✅     |

## Promotion rule

A capability can move from `dev` to `me` only when:

1. it has a local validation command or manual acceptance script;
2. it survives restart/reconnect where relevant;
3. it writes durable state to source, `.project/`, SQLite, or OPFS instead of session memory only;
4. it is documented enough for the next agent/session to operate it;
5. it does not depend on GitHub Actions as the first test runner.

## First consumer priority

For streaming work, the first production consumer should be a UI subscriber that reads generic `StreamSession` and `StreamChunk` nodes through the Tractor observation stream. `BrowserSyncClient` must remain schema-neutral; stream labeling, reduction, and rendering belong in the UI/client-helper layer.

## Runtime Agent Ask Evidence

Current evidence (2026-06-27): the CLI boundary for asking the runtime agent is
already covered at source level. `apps/refarm/test/commands/ask.test.ts`
asserts that `refarm ask` submits an effort with the runtime-agent `respond`
task, then follows the resulting stream and writes streamed content. The broader
mock-runtime acceptance script,
`scripts/ci/smoke-refarm-agent-model-mock.mjs`, exercises plugin reload, `ask`,
task run, task resume, session handoff, task handoff, and stream-file creation
against a mock model provider.

That proves the command and mock-runtime handoff shape. It does not yet prove
that the creator can rely on a live Tractor/runtime-agent loop as the daily
replacement for the external pi workflow.

Validation economy note: app-level Vitest filters are currently easy to misuse
and can fan out into unrelated `apps/refarm` suites. Prefer the mock smoke only
when explicitly validating the runtime-agent path; for documentation-only
status reconciliation, use `git diff --check` plus the Refarm finish lane.

## Runtime Agent Tool Evidence

Current evidence (2026-06-27): the runtime-agent has the local-tool shape needed
for a reference daily driver, but the full daily-driver policy bundle still needs
one live acceptance pass. `packages/pi-agent/src/tools.rs` exposes OpenAI and
Anthropic tool schemas for filesystem, search, shell, structured data, task,
session, and LSP code operations. `packages/pi-agent/src/tool_dispatch/mod.rs`
routes those tool names to specialized dispatch modules instead of a generic
remote shell path.

The host boundary is capability-based. `packages/pi-agent/wit/refarm-plugin-host.wit`
imports `agent-fs`, `agent-shell`, and `structured-io`; `agent-shell` uses
structured argv rather than shell interpolation, and `structured-io` validates
JSON/TOML/YAML before writes. The current Tractor hardening surface is documented
in `packages/pi-agent/ROADMAP.md`: `MODEL_SHELL_ALLOWLIST`, `MODEL_FS_ROOT`, and
`trusted_plugins` gate subprocesses, filesystem reach, and shell-capable plugin
callers at the host boundary. Tool calls are stored in `AgentResponse.tool_calls`
for CRDT audit, as documented in `packages/pi-agent/README.md`.

That proves the local tool contract and audit path. It does not yet prove the
creator can run the live daily-driver loop with the intended checkout root,
shell allowlist, and trusted plugin policy active at the same time.

Current evidence (2026-06-27): the `agent-tools` composition component now has a
focused unit proof for its hard local `agent-shell` guard. `packages/agent-tools`
rejects empty `argv`, rejects requested subprocess timeouts above its 120-second
cap, and accepts requests exactly at the cap. The README now matches the source
cap. The focused signal is:

```bash
cargo test --manifest-path packages/agent-tools/Cargo.toml --lib --quiet
```

That proves the component-local policy guard without starting Tractor or a model
provider. It still does not prove the full live policy bundle: host shell
allowlist, trusted plugin enforcement, checkout root, and audit records active in
one runtime-agent acceptance pass.

Current evidence (2026-06-27): Tractor's host-side policy guards also have
focused local proofs for the daily-driver shell boundary. The host rejects a
command outside `MODEL_SHELL_ALLOWLIST`, blocks shell `cwd` outside
`MODEL_FS_ROOT`, blocks unlisted plugins when `trusted_plugins` is configured,
and formats `agent-tool:shell:spawn` telemetry as an audit line. The focused
signals are:

```bash
cargo test --manifest-path packages/tractor/Cargo.toml shell_allowlist_blocks_unknown_command --lib --quiet
cargo test --manifest-path packages/tractor/Cargo.toml spawn_cwd_outside_fs_root_is_blocked --lib --quiet
cargo test --manifest-path packages/tractor/Cargo.toml trusted_plugins_enforcement_blocks_unlisted_plugin --lib --quiet
cargo test --manifest-path packages/tractor/Cargo.toml format_shell_spawn_event --lib --quiet
```

That proves each host-side policy primitive independently without starting a
model provider. It still does not prove the full live policy bundle in one pass:
runtime-agent tool dispatch must run with the intended checkout root,
`MODEL_SHELL_ALLOWLIST`, `trusted_plugins`, and Scarecrow audit subscriber active
together.

## Memory Persistence Evidence

Current evidence (2026-06-27): Refarm's CRDT memory engine is implemented across
both the browser/TypeScript and native/Rust paths. `docs/SYNC_CHOREOGRAPHY.md`
defines the intended write model: writes go through Loro, queries read from the
SQLite materialized view, local writes do not depend on network, and reconnects
exchange binary Loro updates.

`packages/sync-loro/src/loro-crdt-storage.ts` implements the TypeScript bridge:
`storeNode` writes into a Loro document, `Projector` updates the read model,
`getUpdate`/`applyUpdate` move binary deltas, and snapshot helpers cover cold
boot persistence. Its tests cover local projection, bidirectional sync,
offline-peer merge, snapshot import/export, and the `sync:v1` conformance
provider bridge.

`packages/tractor/src/sync/loro.rs` and `packages/tractor/src/storage/sqlite.rs`
implement the native side: `NativeSync` writes to Loro and eagerly mirrors to
SQLite, exports/imports updates and snapshots, and `NativeStorage` opens either
`:memory:` or a namespaced database under the Refarm data directory. The Rust
sync tests cover update convergence, offline-first roundtrip, snapshot
roundtrip, and idempotent update application. `NativeStorage` also has a focused
file-backed restart proof: `file_storage_survives_reopen` writes a `Task` node to
a real SQLite file, drops the first handle, reopens the database, and verifies
the node, context, payload, and source plugin remain queryable.

That proves the memory engine and the local storage restart boundary. It does
not yet prove the full daily-driver memory acceptance criterion: real decisions,
tasks, and handoffs must survive a daemon/app restart and then roundtrip through
the intended app/runtime path.

## Resume After Interruption Evidence

Current evidence (2026-06-27): the operator resume loop can recover local task
continuation state and expose durable project handoff context without relying on
chat context. `apps/refarm` wires `refarm resume --json` through the task session
checkpoint recorder, finish recorder, active session pointer, `.project/handoff.json`,
recent sessions, recent prompts, runtime status, and model route summary. The
focused source tests in `apps/refarm/test/commands/resume.test.ts` prove two
interruption cases: a new command instance seeing a non-terminal task checkpoint
with no active effort produces `refarm task resume --json`, and the repository
handoff loader carries current tasks and next actions into the JSON resume
envelope.

That proves the local checkpoint handoff and the versioned project handoff read.
It does not yet prove the full daily-driver criterion: Refarm still needs a clear
policy for when `.project/handoff.json` becomes the live source of current work
instead of only contextual recovery data.

Current evidence (2026-06-27): Homestead already owns the first UI subscriber
slice. `StudioShell` registers `onNode("StreamSession")` and
`onNode("StreamChunk")`, reduces them through the stream observation helpers, and
renders both statusbar pills and a dedicated streams slot when the DOM exposes
`refarm-slot-streams`. The focused local signal is:

```bash
pnpm -C packages/homestead run test -- Shell.test.ts stream-observer.test.ts
```

That proves the UI helper and subscriber boundary. It does not yet prove the
full daily-driver path with a real Tractor daemon, `apps/me`, and a live
runtime-agent stream.

## Release consequence

If any minimum daily loop row is still unproven, `v0.1.0` remains deferred. Passing contract tests alone is not sufficient.
