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

## Security debt

- **S1: `boot` silently discarded `config.security_mode` — DONE (eb9d2277).** boot
  now honors the configured posture; the Strict LOAD gate is seeded from the
  sovereign `trusted_plugins` allowlist (absent→permissive, `*`→all, listed→trust,
  configured-omits→deny). Production actually enforces Strict now. The trust model
  was unfinished at issuance; reconciled the sovereign way.
- **S2: Rust↔TS trust mirror drift (ADR-worthy, not yet done).** TS gates plugin
  LOAD on registry status (validated/active) and uses the trust-grant only for the
  trusted-fast execution-profile upgrade; Rust repurposed the grant as the load
  gate itself and has no registry-status concept. The S1 reconciliation kept Rust's
  load-gate semantics (+ the sovereign allowlist). Deciding whether Rust should
  mirror TS (registry-gated load) or TS should mirror Rust is a larger design call
  — wants an ADR. Also unbuilt: the promised `trust_grants` SQLite table
  (schema-migration-strategy.md:30) + a `refarm plugin trust` CLI for explicit,
  persisted, acknowledge-risk grants (the TS `system:security:trust-plugin-once`
  ceremony has no Rust equivalent).

## Process debt

- P1: markdown-lint warnings on memory files (MD032/MD033/MD041) are cosmetic
  false-positives; the memory harness doesn't render them. Not worth per-file
  fixing; noted so we stop re-flagging.
- P2: `apps/refarm/dist` is a gitignored TS-Strict artifact — rebuild after src
  edits (§2) before anything imports from `dist`; nothing to commit.
- P3: **`SidecarState` construction is decentralized** — 7 test call sites remount
  the same 8 fields by hand (`SidecarState::new(Arc::new(...), …, namespace)`), so
  every new field hurts in 7 places (the smell that surfaced when wiring reload).
  Fix: a centralized `SidecarState::for_test(base_dir, namespace)` (or a builder)
  that assembles the defaults once; migrate the call sites. Do it BYTE-NEUTRAL —
  the helper must produce the exact same state the manual construction did.
- P4: **Sidecar suite needs hardening against regression** (Arthur) — the sidecar
  is the critical path (efforts, sessions, plugin reload, dispatch). Before/while
  centralizing test construction (P3) and wiring real hot-reload, tighten coverage
  so a refactor there can't silently mask a regression. Track which endpoints have
  behavioral (not just status-code) assertions; fill the gaps.

## Abstract follow-ons

- **wac composition — HELD (not premature-forever, premature-now).** The one real
  composition pair (`host-effects.wasm ⊕ agent.wasm`) already works via native
  bindings; the "fake" is the correct working state, `load_host_effects` is dead
  code, nothing is blocked. Runtime plugin→plugin linking is an industry limit
  (memory `bytecodealliance-canon-vs-refarm`), not our bug. Revisit trigger: a
  SECOND effect-consumer or a real WASM-path sovereignty-parity requirement. When
  it comes, reach for `wasm-tools compose` (already installed) before adopting
  `wac`-the-CLI as a new dep.
- **grants wasi:http enforcement — end-to-end test gap.** da81c53f made the
  network:outbound grant a real Linker boundary (http-less linker for un-granted
  plugins under Strict). The DECISION is unit-covered and the non-http common case
  is integration-covered, but proving a plugin that IMPORTS wasi:http fails to link
  without the grant needs a wasi:http-importing WASM fixture. Small follow-on;
  toolchain (cargo-component, wasm32-wasip1) is present.
- **grants next interfaces.** The per-plugin-linker pattern generalizes: filesystem
  and sockets are the next WASI interfaces to gate per declared-grant, reusing the
  same seam (a linker variant chosen at load by `PermissionGrant::grants`).

## How to use this lane

- New coupling/oversized finding → add a row here (don't fix inline unless policy
  #4 says pull it now).
- Pulling an item → move it under a dated "## Done" section with the commit.
- This doc is the thing to read before deciding whether a detour is warranted, so
  cleanup is a deliberate choice against a known backlog, not end-of-feature
  archaeology.
