# `apps/refarm` Promotion Ledger — Audit (Roadmap Item 2)

> Status: audit result (2026-06-24). Read-only discovery over `apps/refarm/src` to test the
> accepted critique — does the app concentrate logic that should be reusable blocks? Feeds
> [`CONVERGENCE_ROADMAP.md`](./CONVERGENCE_ROADMAP.md) item 4.

## Headline finding

The strong form of the critique is **not borne out**. `apps/refarm` is largely already the
thin consumer the doctrine asks for: it is composed from Refarm blocks, not hoarding their logic.
The convergence work for UI is therefore **not extraction** — it is growing the one nascent block
(`ds`), making the already-extracted blocks externally consumable, and reconciling one local
abstraction (`credentials/`) with `silo`.

## Evidence

| Probe | Observation | Verdict |
|---|---|---|
| `src/renderers.ts` (36 lines) | Imports `@refarm.dev/homestead/sdk/host-renderer`; only registers refarm's named web/tui/headless descriptors. | Rendering is **already a block** (homestead). App is a thin consumer. |
| `src/model-routing.ts` | A single re-export block from `@refarm.dev/config` (model providers, routes, scopes, credential resolution). | Model routing is **already a block** (config). |
| Block imports across `src` | `@refarm.dev/cli` ×158, `config` ×32, `silo` ×8, `homestead` ×6, plus effort/prompt/stream/task/storage/context contracts, windmill, sower, barn, release-engine, runtime, pi-agent, dispatch-surface, health. | App is **pervasively composed** from ~20 blocks. The 28k lines are command orchestration, not hoarded primitives. |
| `packages/homestead/src/sdk` | Shell, Firefly, Herald, A11yGuard, host-renderer, surface-renderer, surface-slots, surface-inspector, studio-host, plugin-handle, stream-observer/state, l8n-host, runtime. | Shell/UI SDK is **mature** and already the block layer. |
| `packages/ds/src` | `tokens.css`, `styles.css`, one `Button`, contrast test, storybook. | Design system is **nascent** — the real UI gap. |
| `src/credentials/` | Exports `CredentialProvider` + github/cloudflare/model providers + `TokenAuthError`. Does **not** import `silo` (grep empty), while the rest of the app uses `silo` ×8. | App-local credential abstraction **not reconciled** with `silo`. Genuine candidate. |

## Per-category verdicts

| Category | Where the logic lives | Verdict |
|---|---|---|
| Surface rendering (`renderers`, `tui*`, `web*`, `headless*`, `status-surfaces/output`, `actions`) | `@refarm.dev/homestead` SDK | ✅ already block; app wires it |
| Model routing / selection (`model-routing`, parts of `commands/model.ts`) | `@refarm.dev/config` | ✅ already block; `commands/model.ts` (1553 lines) is command UX over it — **spot-check** for residual logic |
| Shell / UI primitives | `@refarm.dev/homestead` (sdk/ui/styles) | ✅ mature block |
| Design tokens / components | `@refarm.dev/ds` | ⚠️ **nascent — grow it** (item 4) |
| Multi-surface dispatch | `@refarm.dev/dispatch-surface` (app imports ×1) | ✅ block exists; **under-consumed** by the app — opportunity to route more surfaces through it |
| Credentials (`credentials/`) | app-local `CredentialProvider`; `silo` used elsewhere ×8 | ⚠️ **reconcile** `credentials/` ↔ `silo` (which owns what) |
| Runtime / sidecar / sessions (`runtime*`, `sidecar-*`, `session*`) | app-local, pending Backend Protocol | ◻ tracked by `specs/features/2026-05-16-refarm-backend-protocol.md` (DRAFT) — promote when that lands |
| Task / tree / plugin (`task*`, `tree*`, `plugin*`) | consume `task-contract-v1`, `plugin-manifest`, `barn` | ✅ consuming contracts; orchestration stays in app |
| Health / check (`health`, `check`) | `@refarm.dev/health` (×1) + app | ◻ minor — more could route through `health` |
| Operator cockpit (`launch*`, `provision`, `deploy`, `init`, `configure`, `doctor`, `brand`, `guide`, `version`, `sow`, `status payload`) | app-local | ✅ correctly app-specific (the thin-consumer cockpit) |

## Real promotion / gap list (the short, honest one)

1. **Grow `ds`** — it is the one underdeveloped UI block; everything else (homestead/dispatch-surface) already exists. (→ item 4 core)
2. **Make existing blocks externally consumable** — `homestead`, `dispatch-surface`, `ds` are consumed *internally* by `apps/refarm` but are not yet scoped/documented/API-stabilized for `vault-seed` to consume. This is DX + packaging + the npm-scope decision (item 3), not extraction. (→ item 4)
3. **Reconcile `credentials/` ↔ `silo`** — decide whether the app's `CredentialProvider` abstraction belongs in `silo` (scoped publishing/credential adapter) or stays app-local UX over `silo`. (small, own decision)
4. **Spot-check the largest command files** (`commands/model.ts` 1553, `ask.ts` 1217, `plugin.ts` 1139, `runtime.ts` 1119) for residual promotable logic vs orchestration. Not asserted here — flagged for a targeted read during item 4. Note: repo enforces a 1000-line complexity check (`repo:complexity`), so these are already on the radar.

## What this means for item 4

Reframe item 4 from "extract UI logic out of the app" to:
**grow `ds` + stabilize/scope/document the existing `homestead`/`dispatch-surface` blocks for external
consumption + reconcile `credentials`/`silo`.** The boundary amendment is already half-real in
code (the blocks exist and Refarm consumes them); item 4 makes them consumable by `vault-seed`.
This raises the weight of item 3 (npm scope) — externally-consumable blocks need a settled scope.
