# @refarm.dev/artefact-contract-v1

Shared lifecycle base types for managed artefacts in the Refarm platform.

## Types

- `ArtefactStatus` — `"draft" | "ready" | "active" | "archived"`
- `ManagedArtefact` — base interface extended by domain contracts (e.g. `automation-contract-v1`)
- `ARTEFACT_TERMINAL_STATES` — `ReadonlySet<ArtefactStatus>` containing `"archived"`
- `canTransition(from, to)` — pure guard function for valid status transitions

## Transition graph

```
draft ──validate()──► ready ──activate()──► active
  ▲                     │                     │
  └──────────────────────◄──deactivate()───────┘
                         │
                    archive() ◄──── (any state)
                         ▼
                      archived  (terminal)
```
