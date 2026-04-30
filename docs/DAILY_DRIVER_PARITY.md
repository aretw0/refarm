# Daily-Driver Parity Checklist

Refarm reaches `v0.1.0` only when it can replace the creator's current external pi workflow for real work. This checklist translates that policy into observable capabilities.

## Minimum daily loop

| Capability                | Refarm surface                              | Local validation signal                                                                                            | Status |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| Start a work session      | `tractor` daemon + `apps/me` shell          | daemon boots, `apps/me` connects to `ws://localhost:42000`                                                         | ⬜     |
| Ask an agent to reason    | pi-agent hosted by Tractor                  | prompt returns an `AgentResponse` and generic `StreamSession`/`StreamChunk` observations when streaming is enabled | ⬜     |
| See live output           | UI consumer of Tractor observations         | Stream chunks render incrementally without special-casing the sync transport                                       | ⬜     |
| Use local tools           | pi-agent tool dispatch through host bridges | filesystem/code/search tools are host-authorized and auditable                                                     | ⬜     |
| Preserve memory           | `.project/` blocks + Loro/SQLite graph      | decisions/tasks/handoffs survive restart and sync roundtrip                                                        | ⬜     |
| Resume after interruption | handoff + project status                    | a new session can recover current tasks from repository/project state                                              | ⬜     |
| Work offline              | `apps/me` + OPFS + service worker           | edit while Tractor is offline, reconnect, and deliver delta                                                        | ⬜     |
| Recover from failure      | SQLite/OPFS backup path                     | restore from backup without graph corruption or lost tasks                                                         | ⬜     |
| Automate reminders        | Windmill/scheduler equivalent               | one-shot and recurring reminders run locally with clear ownership                                                  | ⬜     |
| Govern resource use       | disk + quota + local validation policy      | scoped checks run before CI; cleanup frees derived artifacts without source loss                                   | ✅     |

## Promotion rule

A capability can move from `dev` to `me` only when:

1. it has a local validation command or manual acceptance script;
2. it survives restart/reconnect where relevant;
3. it writes durable state to source, `.project/`, SQLite, or OPFS instead of session memory only;
4. it is documented enough for the next agent/session to operate it;
5. it does not depend on GitHub Actions as the first test runner.

## First consumer priority

For streaming work, the first production consumer should be a UI subscriber that reads generic `StreamSession` and `StreamChunk` nodes through the Tractor observation stream. `BrowserSyncClient` must remain schema-neutral; stream labeling, reduction, and rendering belong in the UI/client-helper layer.

## Release consequence

If any minimum daily loop row is still unproven, `v0.1.0` remains deferred. Passing contract tests alone is not sufficient.
