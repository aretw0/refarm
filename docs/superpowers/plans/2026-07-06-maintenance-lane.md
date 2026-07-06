# Maintenance Lane — coupling, cognitive load, and debt

_Opened 2026-07-06. Single source of truth for cross-cutting cleanup: common
things wrongly coupled to `apps/refarm`, oversized files, and process debt — so we
never stop at the end of a feature to "figure out what to clean" or let sujeira
pile up._

## Operating policy (Arthur)

1. **Don't wait for a second consumer to feel the pain.** The conservative
   "no second consumer yet → defer" rule is too slow. If a common thing is
   coupled to `apps/refarm` (or reimplemented worse elsewhere), we resolve it when
   we see it — with room to discuss case by case. A finding may still be parked,
   but by agreement, not by a blanket rule.
2. **Centralize instead of editing the same thing in N places.** When a fix would
   touch several near-identical sites, first extract the shared piece, then apply
   once (proven this session: `health-commands.ts`, `renderCapabilityError`,
   `env_lock` → `test_support`, `makeProcessCache`).
3. **Grow a big file → shrink it in the same pass.** When the next feature adds to
   an already-large file, slice its size down while we're in there — don't schedule
   a separate "split files" sweep. Cognitive load is paid down opportunistically,
   where we already have the file open.
4. **When to stop and pull from this lane** (Claude proposes, Arthur decides):
   - a feature is about to add >~150 lines to a file already >800 lines → split first;
   - a fix would touch ≥3 near-identical sites → centralize first;
   - a coupling/debt item here sits directly under the file we're editing → fold it in;
   - otherwise finish the feature; do NOT pre-emptively detour for unrelated debt.

## Coupling debt (from the 2026-07-06 liveness-ping audit + since)

Verified findings. Status: OPEN unless marked. "2nd consumer" column is context,
not a gate (see policy #1).

| # | Item | Where | Status | Note |
|---|---|---|---|---|
| C1 | `fetchWithTimeout` mis-homed | was `apps/refarm/src/commands/fetch-with-timeout.ts` | **DONE** (fa43c50c) | Subsumed by C2's repartition: the primitive moved to `@refarm.dev/root` (zero-dep, generic HTTP). The `probeHttpEndpoint` classifier dedup (model.ts ≡ runtime-readiness.ts) is a smaller residual follow-on. |
| C2 | sidecar HTTP client stuck in app | `sidecar-fetch.ts` | **DONE** (fa43c50c) | Split by DOMAIN, not into cli (Arthur: a CLI package is the wrong home for a network client). `fetch-with-timeout`→`@refarm.dev/root`; `sidecar-fetch`→NEW `@refarm.dev/sidecar-client`. context-provider-v1 migrated off its raw fetch. The 42001 bug was already fixed (f1e2a106 + f5b39c8c); this closed the relocation + the raw-fetch reimplementation. |
| C3 | `ProviderProbeReason` contract dup | `sidecar/mod.rs` (Rust) | **DONE** (a9825b78) | Rust probe reason literals hoisted into `PROBE_*` consts mirroring `EFFORT_*`. A `model-liveness-contract-v1` package still waits for a 2nd app speaking `/providers/liveness`. |
| C4 | config-node read-back: only sidecar-URL migrated | `runtime-config.ts` resolvers | **DONE** (1a1a08f1) | Propagated to autostart + engine via a centralized `resolveConfigValueAsync<T>`. Residual: the two other async resolvers could migrate their hot callers, but none is hot today. |

## Cognitive-load debt (oversized files)

Slice opportunistically per policy #3. Biggest first; the ones touched this session
are flagged — likely to grow again.

**TS (`apps/refarm/src`)** — `skill-capability.ts` 1077, **`model.ts` 1077** (grown by
liveness-ping; a prime split candidate — doctor/probe vs routing vs mutators),
`task.ts` 1058, `sessions.ts` 960, `agent-finish-plan.ts` 853, `workspace.ts` 851,
`config.ts` 845, `project.ts` 820, `chat.ts` 779, `task-support.ts` 756, `ask.ts` 755.

**Rust (`packages/tractor/src`)** — `fs_shell_core.rs` 1366 (test), `lib.rs` 1150,
**`sidecar/mod.rs` 1130** (grown by the liveness endpoint), `lsp_bridge.rs` 1073,
`env_and_runtime.rs` 1014, `core.rs` 957. (Memory `fatiamento-rust-tractor-padrao`
holds the verbatim-move slicing pattern; `fs_shell_core`/`sidecar` remained on its
"restam >1000" list.)

## Process debt

- P1: markdown-lint warnings on memory files (MD032/MD033/MD041) are cosmetic
  false-positives; the memory harness doesn't render them. Not worth per-file
  fixing; noted so we stop re-flagging.
- P2: `apps/refarm/dist` is a gitignored TS-Strict artifact — rebuild after src
  edits (§2) before anything imports from `dist`; nothing to commit.

## How to use this lane

- New coupling/oversized finding → add a row here (don't fix inline unless policy
  #4 says pull it now).
- Pulling an item → move it under a dated "## Done" section with the commit.
- This doc is the thing to read before deciding whether a detour is warranted, so
  cleanup is a deliberate choice against a known backlog, not end-of-feature
  archaeology.
