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

| # | Item | Where | 2nd consumer? | Note |
|---|---|---|---|---|
| C1 | `fetchWithTimeout` mis-homed | `apps/refarm/src/commands/fetch-with-timeout.ts` | no (yet) | Pure primitive; relocate to `@refarm.dev/cli` + add a shared `probeHttpEndpoint` classifier (dedupes the ~15-line catch→{ready,error,timedOut} between `model.ts` and `runtime-readiness.ts`). |
| C2 | sidecar HTTP client stuck in app | `sidecar-fetch.ts` / `sidecar-url.ts` | **YES** — `context-provider-v1` reimplemented `GET /efforts` with hardcoded `42001` | Move `fetch-with-timeout`+`sidecar-fetch`→`@refarm.dev/cli`; the sidecar-URL resolver→`@refarm.dev/runtime`. NOTE: the 42001 *bug* is already fixed (f1e2a106 + f5b39c8c); this is the remaining *relocation* so the client isn't refarm-privileged. |
| C3 | `ProviderProbeReason` contract dup | `model-provider-doctor.ts` (TS) ≡ `sidecar/mod.rs` (Rust) | one each side | Cheap now (no package): hoist the Rust probe reason literals into `PROBE_*` consts mirroring the `EFFORT_*` pattern (`sidecar/mod.rs:62`). A `model-liveness-contract-v1` package only when a 2nd app speaks `/providers/liveness`. |
| C4 | config-node read-back: only sidecar-URL migrated | `runtime-config.ts` resolvers | — | `resolveAutostartMode` / `resolveTractorEngineMode` still fs-only. Propagate the `resolveSovereignConfig` seam to them (the pattern + `makeProcessCache` are ready). |

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
