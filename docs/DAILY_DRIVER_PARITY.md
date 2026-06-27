# Daily-Driver Parity Checklist

Refarm reaches `v0.1.0` only when it can replace the creator's current external pi workflow for real work. This checklist translates that policy into observable capabilities.

## Minimum daily loop

| Capability                | Refarm surface                              | Local validation signal                                                                                                                         | Status |
| ------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Start a work session      | `tractor` daemon + `apps/me` shell          | daemon boots, `apps/me` connects to `ws://localhost:42000`                                                                                      | ⬜     |
| Ask an agent to reason    | Runtime agent hosted by Tractor             | `refarm ask` assembles the runtime-agent effort and follows stream chunks locally; live daily-driver Tractor/runtime-agent path pending           | local proven / live path pending |
| See live output           | UI consumer of Tractor observations         | Homestead renders generic stream observations locally; real Tractor/apps-me E2E pending                                                         | local proven / E2E pending |
| Use local tools           | Runtime-agent tool dispatch through host bridges | filesystem/code/search tools are host-authorized and auditable                                                                                  | ⬜     |
| Preserve memory           | `.project/` blocks + Loro/SQLite graph      | decisions/tasks/handoffs survive restart and sync roundtrip                                                                                     | ⬜     |
| Resume after interruption | handoff + project status                    | a new session can recover current tasks from repository/project state                                                                           | ⬜     |
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
