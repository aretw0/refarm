# The Convergence Lane — refarm's ant-journey

> A living work-lane, not a plan. The North Star is large; the method is small. This doc is the map +
> the discipline + the backlog, so the journey resumes at any moment — by another session, another
> agent, or refarm using itself on itself. Update it every pass (move corners between the columns).

## North Star

refarm is the creator's **sole operational surface** — the OS of itself and of everything else. The
goal is that the creator opens neither email nor an IDE; refarm abstracts what is underneath and lets
anyone operate and maintain anything — **private, public, collective, or individual** — with the
progressivity each case needs. It is an aggregator of enabling technologies: take the R&D inspirations
and go beyond them, keeping every case operable.

refarm reaches people three ways (SDK is the base — see the `sdk-first-not-app-coupled` memory):
executable per device (a surface via PWA / Termux / native where the user needs it), an imported lib +
plugins, and full apps via the SDK. A vault like vault-seed (the DGK) is **a refarm app underneath** for
people who want just what it offers, yet compatible to serve any demand refarm is chosen to consolidate.
A colleague who wants, say, a video-editing workflow builds it through plugin extensibility — and may
publish it as an app for everyone.

## The method (the ant-journey)

Convergence is **emergent and organic**, reached by many small pragmatic passes through every corner —
never one grand refactor. Each pass:

1. **Pick the next corner** (from the backlog below, or wherever the real daily-use friction is).
2. **Smallest atomic pass that adds value** — one focused change, verified.
3. **Leave durable material** — a commit, and a spec/memory when the *why* isn't obvious from the diff.
4. **Update this lane** — move the corner between the columns; note what's next.
5. Repeat. Surprise scales with delta size (CLAUDE.md §0); small steps keep free energy low.

Guardrails: SDK-first, never app-couple by consequence ([[sdk-first-not-app-coupled]]); dogfood the
creator's own use before others'; assimilate a generic capability only under real second-consumer
pressure (avoid premature generalization).

## The field (the corners)

- **vault-seed (DGK)** — the reference vault (`~/github/vault-seed`). Ocamento largely done: consumes
  ~12 `@refarm.dev/*` SDK blocks, all consumer-proven (43/43). Remaining = product-layer polish.
- **Private professional vault** (`~/git`, started from an earlier vault-seed phase, based on it) —
  not yet on the current refarm; a future ocamento consumer.
- **rcdc5** (`~/git/rcdc5`) — a vault centralizing work-related things; assimilate its solved patterns
  (SSO, corporate CA, app session) rather than rediscover ([[assimilate-rcdc5-before-solving-alm-problems]]).
- **coop-vault** (GitHub, collective with a partner) — the personal+collective workspace test case
  ([[sovereign-auth-workspaces]], `workspace-access-contract-v1`).
- **Friends' workspaces** — e.g. the doceria (commerce, [[refarm-shop-fourth-domain]]). **Deferred**
  until refarm+vault-seed are complete for the creator (it must work for him before others).
- **Surfaces** — per-device executable, PWA, Termux, and the service that abstracts underneath
  ([[current-phase-interfaces-and-nodes]], [[mesh-binary-distribution-vision]]).
- **Plugins → apps** — arbitrary workflows via plugin extensibility, optionally published as apps.

## Living backlog

**Done (recent):** vault-seed↔refarm convergence proven + hardened; vault-seed product polish + convergence
committed in its repo; promote-check + main aligned to develop; security highs fixed. **Multi-vault survey +
convergence map** — the three other vaults mapped (professional, rcdc5, coop-vault) and the finding recorded
in `docs/superpowers/specs/2026-07-27-multi-vault-ocamento-convergence.md`: **the contract lattice already
assimilated the convergence design** (records/vault/task/provenance/enrichment/source/sync/workspace-access/
automation) — the ocamento is *migration + one missing provider*, not new primitives.

**Doing:** choosing the first grounded ocamento pass (fork A/B/C in the spec) — awaiting operator steer.

**Next corners (grounded):**
- **(A)** prove one vault migration — rcdc5 `WorkItemContent`+`ccm_*` ⇒ `task:v1`+`provenance:v1` w/ consumer test.
- **(B)** build the one missing provider — `source-alm`/`source-oslc` (`source:v1`, sibling of `source-web`) = the creator's "Fase A".
- **(C)** reconcile the design docs — record in rcdc5's `ARQUITETURA-CONVERGENCIA.md` that refarm already fills the roles.
- coop-vault collective proof (`workspace-access-contract-v1` in practice); per-device surfaces (PWA/Termux); plugin authoring ergonomics.

**Held:** the doceria (until creator-complete). **Not cloned:** `notes` (personal vault) — not authorized.

## How to resume

`refarm resume --json` → follow `nextCommands`; read this doc + the specs in `docs/superpowers/specs/`
and the context memories. Pick a corner, take one atomic pass, leave material, update the columns.
