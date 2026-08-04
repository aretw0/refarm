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

**Next — the multi-surface operator path (2026-07-30):** ordered in
`docs/superpowers/specs/2026-07-30-multi-surface-operator-path.md`. (1) a second `OperatorChannel`
adapter over the already-declared tailnet surface, making the phone a second screen for the node's
prompts — measure `web-serve.ts` first, it is unverified; (2) delivery, so a waiting prompt reaches
the operator (Telegram first, Matrix second); (3) the admitted-device-transport and verification
registries, then enrolment initiated from either side; (4) systray, last, as comfort. Each slice is
a **second consumer** of something already built. Enrolment's own design, with the transport and
verification corrections, is in
`docs/superpowers/specs/2026-07-30-phone-initiated-enrolment-design.md`.

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
- **Notifications — the OS tells the operator, unasked** (named by the operator 2026-07-29): *"quero notificações desse sistema operacional que estou montando para mim"*. This is the missing half of everything the connections work just built. Refarm can now be **asked** (`refarm connection status`) and **told** (`refarm connection up`), but it cannot yet **tell**. The operator's original pain was exactly a silence — the VPN died and nothing said so. Two things already exist to build on rather than invent: `stream:v1` already carries `notice` frames over SSE/WS/file transports with a resume cursor, and D13's attention handshake is a notification that expects an answer. The open questions are the delivery surface (Termux, PWA, phone push, the tailnet) and whether a notification is a distinct contract or a projection of `stream:v1`. Do NOT start before the delivery surface is chosen — a notification with nowhere to arrive is a log line.
- **rcdc5 as a refarm app — the ACTIVE front while the operator's VPN is up** (2026-07-29). The operator runs the Serpro VPN manually to work; remote testing (Termux/PWA) waits until they can drop it. Meanwhile the assimilation continues on the corners below.
- **Retire the duplicated fetch path** (needs a LIVE SerproID login to validate — operator-run): point rcdc5's scraper pipeline (or a new `scrape:oslc` command) at `createRcdc5OslcSourceProvider`, retiring the ~80% of `fetchers.ts` (crawl/401-reauth/pacing/cookie-state) that duplicates `source-web`. Parity-gated against the real ALM, in rcdc5.
- **Promote toward rcdc5 self-declaring** = "rcdc5 as a refarm app": stand up the capability-host surface INSIDE rcdc5 (vendor the `capability-host` closure like source-oslc), so rcdc5 declares its OWN enrich verb (over its real vault dir) — a cross-repo, heavier move. Then **B `engine → vault:v1`** (structural: `@rcdcp/extractor-engine` implements the four `vault:v1` verbs), then **A** rebuild almtask's task-gen in rcdc5 (TS) over `task-recurrence`/`task-calendar` using the UST catalog (`~/git/vault/99 - Meta & Attachments/Attachments/catalogo-ust.csv`).
- **More surgical rcdc5 swaps** (each parity-gated): the primaryText→md flow (rcdc5 keeps raw HTML — needs care, not a clean `oslcPrimaryTextToMarkdown` drop-in); `oslcRequestHeaders` at the full-header call-site.
- When Refarm publishes to public npm: swap rcdc5's `file:vendor/*.tgz` overrides for versioned deps.
- **Full external-ALM emit sink** — the inverse of `source:v1` (write work-items OUT to a tracker), wrapping `task-recurrence`'s output; only under real second-consumer pressure. **`task:v1` optional `priority`** (only under real need); coop-vault collective proof (`workspace-access-contract-v1`); per-device surfaces (PWA/Termux); plugin authoring ergonomics.

- **White-label operation catalog + Termux/PWA administration** (the umbrella): the named, shell-free catalog, authenticated `/operations` lifecycle, cancellation, browser/PWA projection, and Termux projection are shipped. `operation-result.v1` transports only bounded, redacted summaries/metrics/findings while stdout remains private; rcdc5 `code-boundaries` is the first downstream producer and completed end to end with 10 packages and zero findings. Existing nodes author the fail-closed spawn boundary with recorded `refarm config spawn-env`, never ambient inheritance or JSON editing. **Next:** operator confirmation on Termux/PWA, then Telegram as another projection of the same contracts. Canonical direction + the Remote-workspace-control track: [`REFARM_WORK_FOCUS.md`](./REFARM_WORK_FOCUS.md).
  - **2026-07-28 — the sign-off happened, and the operator sent the work DOWN a layer instead.** Slice 3's decisions are settled and recorded in the spec below (remote opt-in **per declared command**, default local-only; bind = discover-the-tailnet-IP fail-closed, with `--host` validated and a peer filter as named escape hatches; auth reuses `.refarm/auth-policy.json`). But interviewing surfaced that interactive login is a **substrate** concern — SerproID gates many SERPRO platforms, not just the ALM, and the ladder is QR → user+password+MFA → wizards. So the chosen corner is the ROOT: **declared connections — shared, host-owned interactive sessions** — because `host-shell.spawn` is batch/mute/ephemeral (all stdin up front, all stdout at the end, `timeout-ms` kills) while a login is conversational and must stay alive. Design: [`docs/superpowers/specs/2026-07-28-declared-connections-shared-sessions-design.md`](./superpowers/specs/2026-07-28-declared-connections-shared-sessions-design.md). Tractor is **not** deficient — the plugin path and the shell effect exist and are gated; only the effect's SHAPE is missing.
  - **The operator's ownership correction shrank the contract.** Connections are **shared, not private**: several plugins need the SAME connection, and a private-session model would make each one trigger its own login — for the Serpro VPN, a separate push on the operator's phone. So a connection is a named host-owned resource with *claims*, `ensure` is idempotent (already up ⇒ no second login), and one live instance per declared name is the sensible default (a second profile means declaring a second name, refused loudly otherwise). Because connections are declared in `.refarm/config.json` and plugins only NAME them, the WIT lost `run-flow` entirely — the effect's authority drops from "keep an arbitrary process alive" to "ask for a declared connection", and the permission drops from High to Medium. This is the third application of *catalog, never a shell* (local commands → remote commands → connections). Plugins announce expectations via `capabilities.requiresConnections`, mirroring the existing `requiresApi`.
  - **Why the root path also cheapens slice 3:** the survey found that `stream:v1` (`stream-contract-v1`) already supplies the frame contract with a `sequence` cursor, and the transports are already built and conformance-tested — `sse-stream-transport`, `ws-stream-transport`, `file-stream-transport`, `stream-follower`. A remote surface over `stream:v1` inherits SSE **and** WebSocket without choosing. On the Rust side `StreamChunkObservationDraft.payload_kind` is a `String` and `metadata` is `serde_json::Value`, so `notice`/`prompt` frames are data, not schema.
  - **2026-07-28 — the engine shipped, host-internal** (branch `feat/declared-connections`, six commits). Declaration catalog (`80355629`): a `connections` block in `.refarm/config.json`, parsed and validated filesystem-only — never from the replicated config node, because a connection names a command that runs on THIS machine. `stream:v1` frames (`53d14aae`): `notice` and terminal chunks plus one `StreamSession` per connection instance, with no type change in `packages/tractor/src/streaming/` (`payload_kind` stays a `String`, `metadata` a `serde_json::Value`, so the new kinds are data, not schema). The probe loop (`26328094`): readiness decided by a probe that asks the system, never by matching process output; output produces only human notices. The shared registry (`fd8bf776`): one live instance per declared name, claims, genuine single-flight (a per-connection async gate with a post-acquire re-check), linger, and claims released when their owner goes away. The real adapters (`9be9dc3b`): `spawn_establish_process` and `run_probe`, both reusing the existing spawn guards (`enforce_shell_allowlist`, `enforce_spawn_env`, `enforce_spawn_cwd`) rather than reimplementing them. **A whole-branch review then found the defects that only existed BETWEEN the task commits, fixed in one wave** (`bc6bb395`, `99138364`). Two were structural. The engine's halves did not compose: `establish`/`ensure` took a SYNCHRONOUS probe while the real probe (`run_probe`) is `async`, so the design's central mechanism had never run end to end — both are now generic over a future-returning probe, and two tests wire the REAL probe into the REAL registry against a real establish process, with the probe's verdict deciding Up vs. the establish error. And the stop signal could be lost: `Notify::notify_waiters` stores no permit while the killer task registers late, so on the fast failure paths a real child was orphaned with nothing able to signal it — `notify_one` now stores the permit, proven by tests that assert the PROCESS died rather than that a signal was sent. Four more: a non-zero `linger.idleMs` parsed and was inert (now rejected at parse time); a `ready` `StreamSession` was marked `completed`, putting a LIVE connection's session and its resume cursor in `node_reap`'s terminal set (now stays `active`); `ensure`'s fast path trusted a memoized `Up` forever (now re-probes before issuing a claim); and the parser silently rewrote declarations — a non-string argv entry was dropped, running a DIFFERENT command than declared (now a loud error, as are non-string `env`, `cwd`, `probe.expect`, a non-array `notices`, and non-integer `readyTimeoutMs`/`probeIntervalMs`). Plus: the frame cursor now continues across a re-establish instead of restarting at 0, notices are documented as once-per-ATTEMPT (a cumulative buffer makes a re-armed flag a storm, not a repeat), and the not-yet-wired surfaces carry `#[cfg_attr(not(test), allow(dead_code))]` so `cargo check` is warning-clean again. Test totals, recounted: `connection_decl` **23**, `connection_frames` **10**, `connection_engine` **38** — **71** connection tests (`cargo test --lib connection` reports 72; one pre-existing `wasi_bridge` test matches the substring). `host_effects` **236 → 307**, no regressions. **Next two plans:** the WIT surface (`host-connection` + the `connection:use` permission and its TS mirror, touching the protected `packages/plugin-manifest/**`) and the operator surface (`refarm connection status` + a doctor finding) — followed by the full `ovpnctl` map and step 2 of the design (prompts).
  - **2026-07-28 — the operator surface shipped: refarm can now ASK, and now TELLS.** Three tasks, TypeScript-only in `apps/refarm` — needs no plugin, no WASM, and no populated host registry, because the probe asks the system directly, so the CLI reports live truth today. Task 1, the catalog reader (`7876b05f`, `449c8fbf`): `readConnectionCatalog` mirrors `connection_decl.rs`'s validation but REPORTS instead of failing shut — a broken declaration still appears in `connections` with its issues attached, since an operator debugging one needs to see it, not have the whole read fail; `resolveBinary` resolves a declared argv0 against PATH or as a path, never throwing. Task 2, `refarm connection status [--json]` (`d723d286`, `8e40c93f`): per declared connection, reports the establish argv, whether the establish and probe binaries resolve, and a live three-state verdict — `up` (the probe succeeded), `down` (it ran and said no), `unknown` (it could not even be asked) — never conflating the last two, because the operator's next move differs. The probe mirrors the host exactly: exit 0 AND, when `expect` is declared, the combined stdout+stderr matching it; spawned as structured argv with ONLY the declared environment (`env_clear` parity with `run_probe` → `spawn_process`), never a shell. Catalog-level issues (a malformed `connections` block, too many declared) surface too. Task 3, the doctor finding (`4c0052ae`): a declared connection whose `establish` or `probe` binary does not resolve, or whose declaration carries any catalog issue, becomes a `refarm doctor` warning naming the connection, with `refarm connection status --json` as its `nextCommand` — severity `warning`, never `failure`, since a missing connection binary does not make the host unusable and doctor's failures gate other flows; an empty catalog produces no finding, so doctor never nags about a feature nobody declared. Test totals: catalog + status **46**, the doctor finding **+12** (`connection-doctor.test.ts` **7**, `doctor.test.ts` wiring **5**) — **58** TypeScript connection tests, no regressions. **Still pending, operator-gated:** the WIT surface (`host-connection`) + the `connection:use` permission (touches the protected `packages/plugin-manifest/**`); the claims/since-when half of D12, blocked on the host registry being reachable from the CLI; and D13's attention handshake, with step 3 supervision built on it.

- **Idle-quota worker — the refarm agent on GitHub Copilot** (raised 2026-07-28, next after the effect): the operator has OpenAI and **corporate SERPRO GitHub Copilot** quota sitting idle while all heavy work lands on one vendor. `docs/model-provider-strata.md` already classifies `github-copilot` as a subscription provider and documents the mechanism (GitHub device OAuth → `api.github.com/copilot_internal/v2/token` → the endpoint the token advertises); `GITHUB_COPILOT_ACCESS_TOKEN` already satisfies its credential check. refarm does not lack knowledge of it — it **blocks it honestly**: `refarm ask` refuses subscription routes without a runtime adapter, and only `openai-codex` is in `RUNTIME_SUBSCRIPTION_MODEL_PROVIDERS`. Two halves: (1) TS — `apps/refarm/src/credentials/oauth/github-copilot.ts` mirroring `openai-codex.ts` (PKCE + callback-server + tests already sit beside it); (2) Rust — the `wasi_bridge` runtime adapter that lifts the block.
  - **Unblocked 2026-07-28 — the daily-driver bug that hid the operator's quota is FIXED.** Dogfooding found it: with the runtime up and `doctor` green, `refarm model current` reported `credential.state: "silo-oauth"` while `refarm ask` refused with "No usable model credentials configured", and re-running `refarm sow` never helped. The first diagnosis ("two parts of the binary disagree") was **wrong** — `hasUsableModelCredential` IS `modelCredentialStatus` (`packages/config/src/model-routing.js:132`), so they agree; what differed was the *data* each received. Root cause, verified: Silo writes the credential to `identity.json` under `resolveSiloHome()` = `SILO_HOME || REFARM_HOME || ~/.silo`, while the readiness gate searched only `resolveRefarmHome()` and `<cwd>/.refarm` (`apps/refarm/src/commands/session-launch.ts`). With `REFARM_HOME` unset the store lands in `~/.silo`, which the gate never looked at — so `sow` wrote exactly where the gate was not looking. Environment-dependent, which is why it survived: with `REFARM_HOME` set the two homes are the same directory and the gate happens to work. Fix: `refarmSearchDirs()` now includes Silo's home (the `Set` dedupes when they coincide). `modelCredentialSource` already unwrapped the nested `tokens` shape, so nothing else changed. **Proven live:** `refarm ask` now answers through the operator's OpenAI subscription. The Copilot adapter can proceed on a working rail.

- **2026-08-02 — the first push in six days, and what silence had accumulated.** `develop` had run
  306 commits ahead of `origin` since 07-27, so no CI had judged any of the interfaces/devices work.
  Pushing it surfaced **twelve defects, in four classes** — and the cheap hypothesis (*"the 07-30 HOME
  sandbox made assertions stale"*) would have buried three of them under a test edit:
  - **Real product defects.** `refarm config spawn-env set/unset --local` was silently ignored —
    Commander files an option on the nearest ancestor declaring the same long name, so the flag landed
    on `spawn-env` while `set` read its own `opts()`, and the write went to the HOME scope. This is the
    **fourth** instance of the class `test/architecture/ancestor-option-conformance.test.ts` exists to
    prevent, on the very command the remote-operation handoff tells operators to use. `refarm hardening`
    threw a bare Error out of `parseAsync` instead of refusing (now `guardedAction` + `CommandRefusal`).
    The hardening collector reported the vendored `farm-client` capsule as unhardened debt because
    `moduleFor` anchored the `src/`→`dist/` convention at the package root and could not see a
    capsule's own `dist/` — phantom debt from a mapping gap, not from drift.
  - **`farm-start "<id>"` never worked from the kit.** The operator hit it first try on Termux: with no
    `--status`/`--cancel` on the line, `indexOf` returned `-1` and `index !== statusAt + 1` became
    `index !== 0`, dropping the operation id itself; unquoted, `farm-start delivery add` started `"add"`,
    a *different* operation, silently. The end-to-end proof had gone through `POST /operations`
    directly, so the kit's own path was never exercised. **Proving a contract does not prove a surface.**
    Parsing now lives in `remote-initiation.mjs` as `parseStartArgs`, where the suite reaches it.
  - **Two hand-maintained registries had gone unfed** by a week of new packages: the scaffold contract
    (two public packages shipping `dist/**/*.tsbuildinfo`) and `TASK_SMOKE_TS_BUILD_ORDER` (thirteen
    missing entries, which broke the Windows/macOS jobs before they built anything).
  - **A floor that measured the runner, not the repo.** Hardening's `conformant >= 20` read 19 in CI and
    24 locally, because Verify's build is filtered to the changed set; the quality job now builds the
    workspace the collector imports, the same guarantee the Tractor smoke already carried.
  - **The lane's own lesson, and the debt paid the same night.** `before-push` ran none of the three
    repo-wide gates — the scaffold validator, the build-order integrity check, the high-severity audit
    — so all three were CI-only, and four of the twelve reached `develop` through that gap. The lane
    now runs them (`4827c20e`), each proven by breaking it on purpose and watching the lane refuse with
    the failing step named. They belong to `before-push` and no earlier lane: each asks a whole-repo
    question, so charging it to a one-file edit would be the wrong price, and a push is the first
    moment the question is really being asked. The audit BLOCKS rather than warns, matching CI instead
    of softening it — this lane's contract is to say what the pipeline will say (CLAUDE.md §6), and
    `auditConfig.ignoreGhsas` is the escape hatch that charges a written reason.
  - **The fix for the field bug produced a second field bug, and the anatomy is the lesson.**
    Extracting `farm-start`'s parsing into `parseStartArgs` removed two `const` declarations and
    left both references behind; the operator got `ReferenceError: cancelAt is not defined` on
    their phone, from a kit the node had already published. Three checks had agreed and all three
    were looking elsewhere: `node --check` only parses, so a runtime reference is invisible to it;
    the grep that followed searched the names the author remembered deleting; and the 200-test
    suite covers `src/`, which a bin is not. **The extraction that made the parsing testable left
    the bin less covered, because it added a seam.** `farm-client` is the only plain-JavaScript
    package here, so the shared preset's `no-undef` — off because TypeScript already refuses one —
    left the artifact that ships to a phone with no static check at all. It now lints
    (`5eb8382d`), proven by reproducing the exact regression and watching `node --check` pass while
    the lint names both lines. Corollary worth keeping: a kit fix is not delivered until
    `refarm dist publish` runs — committed code is not code on the phone.
  - **2026-08-03 — the operator journey CLOSED, from the phone.** `farm-start
    "workspace:rcdc5:code-boundaries"` started the declared operation, `farm-attend --watch`
    waited and left cleanly, and `farm-start --status` returned `succeeded (exit 0)` carrying the
    bounded `operation-result.v1` — *Code boundaries valid across 10 packages*, `packagesScanned: 10`,
    `issueCount: 0`, stdout never travelling. The contract had been proven a day earlier through
    `POST /operations`; this is the first run through the surface an operator actually types.
    Three field bugs stood between the two, and each was found by using it rather than by testing it:
    the argv parse that dropped the operation id, the extraction that left two references without
    their declarations (`farm-client` had no lint at all — the only plain-JS package here, so
    `no-undef` was off and the artifact that ships to a phone had no static check), and the secret
    mask that grew past the row so every redraw left its own `visibleTail` behind. `farm-auth` also
    met Ctrl+C with a stack trace: the one bin that asks the operator anything was the only one of
    seven with no cancellation handling, and a conformance test now fails if a bin that asks lacks it.
  - **The node resolves its declarations from where it was started, and it should not.** Restarting
    the runtime from the repository instead of `~` made a declared operation fail with a message
    about a missing envelope — the spawned `refarm` had read the REPOSITORY's config, where that
    workspace declares something else. The node already receives `--refarm-dir` and threads it to
    the auth policy and Scarecrow; declaration resolution asks `current_dir()` instead. Ten
    production sites mapped into three groups (five are the node's declarations, two derive from
    them, three legitimately mean "the current project"); the seven move together or none do.
    Design: [`2026-08-03-declared-node-base-design.md`](./superpowers/specs/2026-08-03-declared-node-base-design.md).
    `packages/tractor/**` is protected (§8), so it waits on the maintainer.
  - **The thirteenth was not a defect at all.** `tidy.test.ts` pinned one of the two spellings
    `createPackageScriptCommand` produces (relative when it can reach the target downward, absolute
    otherwise), so its verdict depended on the directory vitest was launched from: green under turbo,
    which runs inside the package, and red from the repo root. It now pins the RULE and passes from
    either (`e1acd409`). A test whose answer depends on your working directory is worse than a failing
    one — it teaches you to distrust the signal, and it cost this session a false open question.

- **2026-08-03 — the muteness under the coupling, and the operator's own measure of convergence.**
  Real Termux use returned two defects. The select prompt reprinted itself on every keypress:
  `renderedLines` counted LOGICAL lines while `moveCursor` climbs PHYSICAL rows, so a wrapped option
  made the redraw rise short and leave everything above it — the same family as the secret mask, and
  wrong only where the rows are narrow, which is where an operator stands. Fixed and republished.
  The second was reported as "the flow seems coupled to Telegram" and is not a text problem: with one
  registered adapter the wizard selects it in SILENCE, never saying it is a registry — and, deeper,
  **the operator channel can only ASK**. There is no notice/announce, so `delivery add`'s preflight
  ("the bot is yours; refarm does not talk to BotFather for you") never left the node while the
  questions travelled. A remote wizard today cannot contextualise, only interrogate, and every future
  surface inherits that. The announcement contract therefore precedes Telegram-as-surface and the PWA
  rather than following them.
  - **The ocamento, reframed by the operator and better for it:** not "declare operations" but
    position rcdc5 and vault-seed as CONSUMERS of refarm-as-framework — each gets its own CLI and
    compatibility, declares installable operations, and reports DX pain back. The direction inverts:
    the repo adopts refarm and complains, rather than refarm reaching into the repo, and the
    complaint is the instrument.
  - **And the measure of the convergence itself, in the operator's words:** the moment meta-work
    separates from work is not a state of refarm but a COST CURVE. Declaring the first operation cost
    ~15 refarm fixes. When the Nth costs zero, it has arrived — countable, not felt. The discipline
    that follows: when the work lane hits a wall, RECORD it and declare the next operation; batch the
    meta afterwards. Today did the opposite, correctly, because the first walls were broken ropes.
  - **What `/attend` already is**, measured rather than assumed: complete for catalog + start +
    status + prompts, over HTTPS at `<tailnet>:4322/attend` (the plain listener on 4321 is by design;
    TLS is ADDED beside it on `port + 1`). The installable-PWA gap is home screen, offline and push —
    not capability. The PWA companion deserves a design pass for what is of ITS OWN nature before it
    is built as `/attend` with an icon.

- **2026-08-03 (late) — the budget laboratory, and what auditing a number found.**
  A three-line symmetry fix was refused, and the refusal is the whole story. The dispatch deadline was
  a boot-read global while the sibling prompt path had always let the asker declare and the node clamp;
  the operator would not take the fix alone, because *"a knob without a record manufactures the debt it
  was meant to remove."* Thirteen tasks later: three axes declared per dispatch, resolved across three
  nested levels (node ⊇ workspace ⊇ dispatch, the ResourceQuota/LimitRange pairing Kubernetes settled a
  decade ago, with the record naming WHICH level bound the run); a durable `BudgetObservation` per
  terminal effort under OpenTelemetry's `gen_ai.*` names; `refarm budget observations` to read it back;
  `refarm dispatch --budget-*` to declare it. Proven end to end against the live daemon from the CLI.
  Design: [`2026-08-03-budget-laboratory-design.md`](./superpowers/specs/2026-08-03-budget-laboratory-design.md).
  - **The audit underneath found six live defects, none of them new and none catchable by a test.**
    Cache reads and writes were summed despite being priced in opposite directions; Anthropic's
    uncached input was billed at **zero** under any real cache rate; every Claude 5 model fell through
    to the value meaning "local, free"; Groq's, Together's and Mistral's defaults — paid APIs — were
    classified free; Haiku 4.5 carried Haiku 3.5's retired rate; and Opus 4.5 and later inherited Opus
    4's price, **over by three times**. The two rate errors point in opposite directions, which is the
    argument against any heuristic: no bias to correct, no sanity check that would fire. Only the
    vendor's page answers, one branch at a time — which is why every rate now cites where it was read,
    and why fetching those citations *was* the audit that found two of the six.
  - **Nothing would have objected.** The tests assert the formula uses the rate correctly, never that
    the rate matches the world. `agent-bench` asserts token counts against a mock with known counts,
    never the price derived from them. The gate that now fails when a default model has no rate is the
    instrument that closes it, with a shrinking baseline of six known-unpriced defaults and a
    parse-sanity floor so a broken parse screams instead of passing clean.
  - **The recurring shape, five times in one program: written, correct, and unreachable.** A
    three-level fold whose caller passed `None`; two guards nothing carried a ceiling to; an
    accumulator that never reset between runs; a whole budget system no surface could set; and — found
    by the final review, still open — **nothing anywhere sets `workspaceId`**, so D9's middle level and
    `budget.workspaces` in the config remain theory. Every task review passed, because each looks at
    its own diff and the defect lives in the absence of something outside it. Four of the five were
    caught only while preparing the *next* task, the one moment anyone looks at two layers at once.
  - **Still open, and named rather than buried:** "died at 4/25" — the measurement that originated the
    entire design — is *still* not recoverable from the record, because `steps_completed`/`steps_planned`
    are hardcoded `None` at the only production caller. And `packages/health`'s `ConfigNodeAuditor` has
    never audited a real replicated node: the graph client requires `@context`, the Rust sidecar never
    sets it, and a `try/catch` turns the throw into a soft "skipped" note. **`refarm health` contains a
    check that has always passed by never running.** Pre-existing, unrelated to this work, and it
    deserves its own spec.

**Held:** the doceria (until creator-complete). **Not cloned:** `notes` (personal vault) — not authorized.

## How to resume

`refarm resume --json` → follow `nextCommands`. The canonical restart note is
[`REFARM_WORK_FOCUS.md`](./REFARM_WORK_FOCUS.md) (North Star + the ocamento umbrella + the track orbit ledger);
this doc is the ant-journey lane. Read both + the specs in `docs/superpowers/specs/` and the context memories.
Pick a corner, take one atomic pass, leave material, update the columns. **The direction does not rest until
every creator operation is ocado under one surface (Termux/PWA) — generic capabilities in refarm, specifics in
their own workspace, cross-workspace operations composed from the same operational layer.**
