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

**Done — the C→A→B program shipped (2026-07-27):**
- **(C)** reconciled the design docs — annotated rcdc5's `ARQUITETURA-CONVERGENCIA.md` + this repo's spec: refarm already fills the roles; sovereign boundary (generic OSLC+auth → refarm, SERPRO → rcdc5); `almtask` write-back folded in.
- **(A)** proved one vault migration — `examples/reqbench-t3/src/workitem-task.test.ts`: rcdc5's `ccm_*` work-item ⇒ `task:v1`+`provenance:v1`, overlay preserved, boundary asserted (5/5 green).
- **(B)** built + consumed the missing provider — `packages/source-oslc` (generic OSLC/Jazz toolkit, 7/7); reqbench-t3 rewired to consume it, duplication dropped, full suite 90/1-skip green.
- **almtask kernel** — `packages/task-recurrence` (generic recurring-task → `task:v1` expansion, 8/8); the write-side complement of source-oslc. SERPRO UST/CSV/emit stays in rcdc5.
- **Full `source:v1` OSLC provider** — `createOslcSourceProvider` in `packages/source-oslc` (composed over `source-web`: resolve/materialize/status/refresh/discover + session/egress/cache/provenance; OSLC driver injected; 401→re-auth). 11/11 green. The read side is complete.
- **almtask fully generic-extracted** — `packages/task-calendar` (iCalendar `.ics` → `task:v1`, 4/4) joins `task-recurrence`; both of almtask's task generators are now generic in refarm. SERPRO UST/CSV stays in almtask.
- **rcdc5 migration blueprint** — `rcdc5/docs/OCAMENTO-REFARM.md` (commits `0e12c8c`/`077e52b`): the per-package generic↔specific map, migration order, Nexus note, and the surgical-not-bulk finding (Playwright fetch stays; only parity-proven primitives swap).
- **rcdc5 FIRST real consumption — DONE** (rcdc5 commit `2dba058`): `@rcdcp/scraper-playwright` `core/fetchers.ts` consumes `source-oslc`'s `extractOslcAttachmentRef` for the attachment coordinate, gated by a parity test (byte-identical to the old regexes). Refarm vendored as tarballs (source-oslc + closure) with `pnpm-workspace` overrides; `pnpm install --offline` (no registry change). Baseline preserved: typecheck 0, **99 tests** (97 + 2 parity), tsup build green. The rail works; rcdc5 consumes refarm.

**The operate-model turn (2026-07-27, later) — from *consuming blocks* to *being operated by refarm*.**
The maintainer sharpened the North Star: the goal is not "rcdc5 imports `@refarm.dev/*`" (that's the consequence) but **operating rcdc5 FROM refarm** — rcdc5 becomes a workspace declared into refarm's operational surface as capabilities the runtime drives. Three surveys grounded this in what already exists:
- **The operate-runtime exists**: `defineCapabilityHost`/`defineCapabilityApp` (`@refarm.dev/capability-host` → `capabilities-v1`) — an app declares capabilities as `extensions`, refarm's runtime mounts/dispatches/serves them across CLI+HTTP+TUI+OpenAPI+operator-status. `examples/reqbench-t3` is the working template (already consumes `source-oslc`, already holds the `ccm_*→task:v1` proof, README names rcdc5 as the reference). `apps/refarm` already drives declared workspaces (`commands/workspace.ts`, `vault-discovery.ts`).
- **Honest constraint**: rcdc5's heavy scraping (network + fs writes) **can't be a sandboxed WASM plugin today** — `createWasmSourceProvider` rejects `materialize/resolve/refresh` (host-effect gap). So "operate rcdc5" runs as a **capability-host app with host-side TS providers** (the reqbench-t3 shape), not WASM plugins yet. WASM purity is a later corner gated on real gaps (host-effect provider path, Barn `FilesystemCacheAdapter`, a remote installer).
- **The lightweight scraper already ships**: `source-web` (substrate) + `@refarm.dev/browser-driver` ("light, injectable browser-login… any site, any use", puppeteer optional) + `source-oslc` (protocol). rcdc5's Playwright is ~80% duplicated generic OSLC scraping around one specific piece — the **SerproID QR login** — which becomes an injectable `BrowserSession.ensureLoggedIn` adapter (and the seam to experiment with QR vs user+password+MFA flows).
- So far refarm *distilled* rcdc5 (`task-recurrence`/`task-calendar`); the reframe is the correct flip to *operating* it. Order set by the maintainer: **C (enrichment) → B (engine→vault:v1) → A (task-gen)**. UST catalog for A: `~/git/vault/99 - Meta & Attachments/Attachments/catalogo-ust.csv`.
- **C, rung 1 — DONE**: `examples/reqbench-t3/src/rcdc5-enrichment.ts` + `.parity.test.ts` — reqbench's proven operate-surface (the same `createRulesEnrichmentProvider` the capability-host drives) now runs rcdc5's **REAL** rules (its `.rm-enrichment.json`: CNPJ/CPF/integração) instead of the synthetic `REQ_ENRICHMENT_RULES`, proven **byte-identical** to rcdc5's own `@rcdcp/rm-enrichment` runner (oracle inlined; the space-vs-`\n` multi-source join proven immaterial). Provenance now stamped per tag (`rcdc5.rm-enrichment`), which rcdc5's runner never produced. Sovereign boundary held (rules/`rcdc5/` vocab are a labelled fixture; engine stays generic).
- **C, rung 2 — DONE**: `examples/reqbench-t3/src/rcdc5-enrich-capability.ts` + `.test.ts` — `createRcdc5EnrichCapability` is a `CapabilityDescriptor` the runtime drives; the dispatch proof runs it through **`dispatchCapability(entry, tokens)`** (the ONE resolve→validate→run path every CLI/HTTP/TUI surface shares), parsing `--apply` from tokens, returning the tag decisions + provenance. This is "`<cmd> enrich` operates rcdc5's enrichment" closed end-to-end, without touching rcdc5. Baseline: type-check 0, **reqbench-t3 109 tests + 1 skip** (was 90; +19 across rungs 1+2), no regressions.

- **Scraper convergence — Playwright adapter DONE**: `@refarm.dev/browser-driver` now ships a `/playwright` entry (`createPlaywrightSession`) beside `/puppeteer` — same `BrowserSession` contract, `chromium` injectable so it's unit-tested against a fake (no real browser), `playwright-core`/`playwright` lazily imported (bring-your-own, package stays light). The browser-agnostic login-detection loop was lifted into the shared entry as `awaitLoginDetected(probe, signals)` + `LoginSignals`/`LoginProbe` (tested deterministically). A project's SPECIFIC login (SerproID QR) plugs in as its own `LoginSignals`/`ensureLoggedIn`; everything above stays generic — the reusable login block any workspace leans on. browser-driver: type-check 0, **20 tests**, build green; no consumer broke (reqbench-t3 type-check 0).
- **rcdc5 consumes browser-driver — 1st sub-step DONE** (rcdc5 commit `ef24338`, branch `vault-upgrade`): `packages/scraper-playwright/src/core/browser-session.ts` — `createSerproBrowserSession` wraps rcdc5's `ScrapeSession` behind the generic `BrowserSession` (ensureLoggedIn→SerproID login + context cookies; fetchInSession→`safeRequestGet` on the `APIRequestContext` adapted to a `Response`; navigate/close pass through; session factory injectable). Fake-session smoke test, 5/5. Vendored `browser-driver` tarball + override (offline install `--no-optional`, skips puppeteer-core). **Strictly additive** — `core/session.ts`/`core/fetchers.ts` untouched; baseline preserved (type-check 0, **104 tests**).
- **rcdc5 assembles its OSLC source:v1 from blocks — 2nd sub-step DONE** (rcdc5 commit `9ae63d7`): `core/oslc-source.ts` — `createRcdc5OslcSourceProvider(config)` = `createSerproBrowserSession` → `createLiveFetch` → `createOslcSourceProvider`, a full source:v1 provider. **How thin the specific part got:** the only SERPRO logic is the login; `baseUrl`/`targets`/`allowedHosts` are config DATA. Fake-session test drives the whole chain (materialize lands the RDF; the OSLC Accept + Configuration-Context reach rcdc5's `APIRequestContext`), 2/2; baseline type-check 0, **106 tests**. Evaluation (operator's thinness lens): the `BrowserSession → OSLC provider` composition is generic but stays in the consumer until a 2nd consumer needs it — then it graduates to a refarm block.

- **Machine empowerment — VPN operable from a command, DONE + LIVE-PROVEN** (refarm `fc21ea27`/`dea6bce6`; rcdc5 `3bebc17`): new generic block `@refarm.dev/login-flow` — `runLoginFlow` (drive an interactive connect/login CLI to a ready state; pattern-matched states, obfuscated stdin prompts, human notices) + `superviseConnection` (reconnect-on-drop via health polling; owns the process, no orphan). Injectable process → fully fake-tested (10 tests + a real-process e2e). The Serpro adapter `@rcdcp/serpro-vpn` (in rcdc5, consuming login-flow vendored) drives the real `ovpnctl` — `serpro-vpn connect [profile]`, cert + phone-push (no secret), `ovpntun0` health, 9 tests on real fixtures. **LIVE-PROVEN:** an agent ran one command, the operator only approved the SerproID push on their phone, and `ovpntun0` came UP (172.20.x). Boundary held: only the phone-push login is Serpro-specific; nothing Serpro in refarm. (VPN ≠ ALM session — the latter is QR/SerproID or user+password+MFA, a separate flow that reuses login-flow's obfuscated prompt for the MFA code, Termux-portable.)

**Next corners (grounded, unordered — take by real friction):**
- **Retire the duplicated fetch path** (needs a LIVE SerproID login to validate — operator-run): point rcdc5's scraper pipeline (or a new `scrape:oslc` command) at `createRcdc5OslcSourceProvider`, retiring the ~80% of `fetchers.ts` (crawl/401-reauth/pacing/cookie-state) that duplicates `source-web`. Parity-gated against the real ALM, in rcdc5.
- **Promote toward rcdc5 self-declaring** = "rcdc5 as a refarm app": stand up the capability-host surface INSIDE rcdc5 (vendor the `capability-host` closure like source-oslc), so rcdc5 declares its OWN enrich verb (over its real vault dir) — a cross-repo, heavier move. Then **B `engine → vault:v1`** (structural: `@rcdcp/extractor-engine` implements the four `vault:v1` verbs), then **A** rebuild almtask's task-gen in rcdc5 (TS) over `task-recurrence`/`task-calendar` using the UST catalog (`~/git/vault/99 - Meta & Attachments/Attachments/catalogo-ust.csv`).
- **More surgical rcdc5 swaps** (each parity-gated): the primaryText→md flow (rcdc5 keeps raw HTML — needs care, not a clean `oslcPrimaryTextToMarkdown` drop-in); `oslcRequestHeaders` at the full-header call-site.
- When Refarm publishes to public npm: swap rcdc5's `file:vendor/*.tgz` overrides for versioned deps.
- **Full external-ALM emit sink** — the inverse of `source:v1` (write work-items OUT to a tracker), wrapping `task-recurrence`'s output; only under real second-consumer pressure. **`task:v1` optional `priority`** (only under real need); coop-vault collective proof (`workspace-access-contract-v1`); per-device surfaces (PWA/Termux); plugin authoring ergonomics.

**Held:** the doceria (until creator-complete). **Not cloned:** `notes` (personal vault) — not authorized.

## How to resume

`refarm resume --json` → follow `nextCommands`; read this doc + the specs in `docs/superpowers/specs/`
and the context memories. Pick a corner, take one atomic pass, leave material, update the columns.
