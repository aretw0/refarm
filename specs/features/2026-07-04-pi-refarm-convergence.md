# pi ↔ refarm Convergence Spec

_Source-verified 2026-07-04. Every load-bearing claim below was checked at the source in `/workspaces/refarm/packages` and the pi/agents-lab caches; corrections from the adversarial pass are folded in._

---

## 1. Thesis

Refarm should converge with pi's ecosystem by **supporting what pi standardized and offering what pi structurally lacks** — not by copying pi. pi's portable **Agent Skill** (markdown prose: `name`/`description`/`instructions`) is a real de-facto standard and is **translatable into refarm today** through the existing `parseSkillMarkdown` → `plugin-surface-loader` path (empirically 29/29 agents-lab skills round-trip). Everything pi calls an "extension" (in-process TypeScript: `registerTool`, `registerCommand`, `on(event)`, `registerProvider`) runs with **full system permissions and no sandbox — by design** (pi `security.md:31-35`, `extensions.md:110`). Refarm's differentiation is the inversion: it can host the same operator verbs **inside a declared-capability gate plus a deny-all WASM boundary** (proven runnable in `quality-checker-ref`), a boundary pi cannot express. So: skills translate; extensions get rewritten behind a capability boundary. **Non-negotiable constraint on every bridge: the refarm agent is itself a plugin** (`world agent` in `plugin-wit/wit/worlds.wit`, exports `integration`, imports host capabilities). Extending the agent must therefore be _a plugin contributing to another plugin_ through the **same** surface/loader/boundary — with **no privileged agent path**. A bridge that only works when the target is the host has failed the architecture.

---

## 2. THE RECURSION VERDICT (load-bearing — read first)

**Question:** does refarm's architecture actually let plugin A extend plugin B — where B may be the host _or_ the agent — uniformly, today?

**Verdict: NO, not as a live path. The recursion is real in the WIT contract and in the front-half loader, but the back-half link is host-simulated. It is the thing that must be built FIRST before any pi-extension convergence lands on the agent.**

### The front half PASSES (real, reusable, consumer-agnostic)

`plugin-surface-loader/src/index.ts:179` `loadCheckersFromManifest` iterates `getExtensionSurfaces(manifest)` with **no layer filter** (verified: `getExtensionSurfaces(manifest, layer?)` — `layer` optional, `extension-surfaces.js:34`), matches on a free-string `kind` (`plugin-manifest/src/index.d.ts:35` `kind: string`; `validate.js:125` only requires non-empty), and returns `DiscoveredChecker{surfaceId, entryAsset}` **deferring load+sandbox to the host, assuming nothing about who the consumer is.** A `{kind:"capability-provider"}` surface needs **zero schema change**. `storage-node-view.openScopedLedger` is a valid registry substrate. **This is the seed of fatia #C** — surface → registry → consumer — and it is genuinely consumer-agnostic.

### The back half BREAKS at two independent places

1. **No Component Model composition tooling exists anywhere in tractor.** Grep for `wac` / `wasm-compose` / `InstancePre` / `func_wrap` / `CompositionGraph` / `define_instance` over `packages/tractor/src/` returns **empty**. `agent-tools.wasm` is instantiated in a **separate store + separate linker** (`plugin_host/core.rs:125-127`: `linker` vs `agent_tools_linker` — not merged) and the held component is `#[allow(dead_code)]` (`core.rs:88,91` — held, never linked). The agent's `agent-fs`/`agent-shell` imports are satisfied **natively** by `TractorNativeBindings` (`agent_tools_bridge/core.rs:29,92`), confirmed by `host.wit:108` verbatim — _"tractor satisfies agent's import natively until full Component Model composition"_ — and the `Fase 3` compose TODO at `core.rs:89` (`HANDOFF.md Tarefa 2B`). So substituting an **arbitrary discovered** provider for the agent's import is not a runtime path; even the bundled composition is deferred.

2. **The agent has no dynamic tool seam regardless of composition.** `tools_anthropic()` is a static array in the binary (`agent/src/lib.rs:100`), and dispatch ends in an "unknown tool" arm. Adding a _new_ agent tool is a **second, harder** body of work that composition alone cannot reach.

### Which bridges pass vs. break the recursion

- **PASS (pure-compute / data-only, consumer-agnostic today):** SKILL translate, session persistence, the OBSERVE slice of the event bus, the declarative model-provider row, the pure-compute half of `registerTool`. These project uniformly because they either move data or run an imports-nothing component behind the proven deny-all boundary (`quality-checker-ref/src/index.ts:49-55,116` — real, tested, `SANDBOX` assertions).
- **BREAK-RECURSION (silently assume host target / need the live link):** `registerCommand`+`ctx.ui` (the interactive envelope has no agent-side renderer), event-bus **GATE/TRANSFORM** (routing an in-flight artifact through a discovered `respond` plugin is entirely unbuilt), discovery/`.pi/settings.json` curation (invented a non-existent "node scope" — see below), and **THE RECURSION** itself.
- **One corrected illusion:** the discovery bridge hung plugin-extends-plugin on a **third `node` ledger scope**. That scope **does not exist**: `storage-fs/src/scope.ts:17` `LedgerScope = "user" | "workspace"` (closed union), and `orderedScopeStorePaths` folds exactly those two (`scope.ts:64`). Consumer identity must live in the **rule-data key** (`consumerScope`, `contributorPluginId`) over the real two-layer fold — not a ledger tier.

### The one foundational gap

Between the design-ahead WIT (`agent-tools-provider` exports → agent imports, `world.wit`) and a **live dynamic plugin→plugin link** sits: (a) introducing Component Model composition into wasmtime **from zero**, plus (b) satisfying the provider's **own** imports transitively under deny-by-default (`agent-tools-provider` itself imports `host-spawn` — a nested composition the imports-nothing `quality-checker` design-ahead never exercises), plus (c) merging the two linkers. The proven sandbox is a **jco in-process import table**, not a Component-Model deny-table — so sovereignty parity across the WASM-consumer path is **asserted, not demonstrated**.

**Decision: the recursion is NOT real today. It is the prerequisite.** Any pi-extension bridge whose target is the agent is design-ahead until the live link lands. **Therefore the FIRST slice must either (a) be a bridge that passes the recursion _without_ needing the live link, or (b) be the first honest increment of the link itself.** See §4.

---

## 3. Bridge Table (ranked by priority)

| pi artifact | refarm analog | bridge kind | effort | priority | sovereignty angle | plugin→plugin |
|---|---|---|---|---|---|---|
| **SKILL.md** (prose: name/description/instructions/`disable-model-invocation`) | `skill-contract-v1` `parseSkillMarkdown` + `plugin-surface-loader` `loadSkillsFromManifest`; surface `{kind:"skill"}` | **translate** (thin translator, no new contract) | **s** | **now** | integrity/preflight/ledger + deny-all vs pi's read-on-demand + coarse project-trust boolean | **passes** |
| **`registerTool`** (TypeBox params + JS `execute`, in-process, no sandbox) | `quality-contract-v1`/`quality.wit` compute half (proven); differentiated half needs `agent-fs`/`agent-shell` import + surface `capabilities[]` | **rewrite** (split: compute now, fs/shell design-ahead) | **l** | **next** | per-tool WASM capability boundary; pi tools have **raw Node/Bun authority** (bypass even `pi.exec` via `child_process`) | **passes** (compute) |
| **`registerProvider`** / model scoping | `model-routing.js` (scopes default/worker/monitor) + tractor `wasi_bridge` route enforcement + host-side credential injection | **translate** (declarative row) / rewrite (oauth) | **l** (m if scoped to bearer/standard-path) | **next** | `host.wit:28` "credentials stay in host, plugin never reads keys" — `enforce_llm_route` + host-side key injection; pi stores resolved apiKey in an in-process Map the agent reads | **passes** |
| **`pi.on(~30 events)`** — `tool_call{block:true}` | `integration.wit:36` `on-event` (OBSERVE, fire-and-forget) + `event-contract-v1` EventBus; GATE/TRANSFORM via `respond` | **OBSERVE=translate (mostly built)** / GATE+TRANSFORM=rewrite (design-ahead) | **l** (OBSERVE **s**) | **next** | denied capability throws at boundary (proven for imports-nothing); GATE needs generic composition | **breaks** (GATE/TRANSFORM assume the live link) |
| **`registerCommand`/`registerShortcut`** | `CapabilityDescriptor` (`transports.repl.slashAliases`, `tui.shortcut`, `resolve()`); Registry reserved-name gate | **translate** (command/slash/key — superset of pi) | **m** | **next** | pure `run()` behind declared capability + deny-all; pi's only gate is load-time project-trust | **passes** (command) |
| **`ctx.ui`** (live terminal handle: select/confirm/input/setWidget…) | _none_ — must design an "interaction envelope" declare→render→re-invoke contract | **new-surface** (net-new architecture) | **l–xl** | **later** | must not break `run()` purity (`types.ts:28-33`) | **breaks** (no agent-side renderer) |
| **session `appendEntry`** (append-only JSONL parentId tree) | **already built:** `session-contract-v1` + `storage-sqlite/session-v1.adapter` + `agent/src/session/*.rs`; needs wiring over `storage-node-view`/`openScopedLedger` | **translate** (wire existing, don't rebuild) | **s** | **next** | storage-as-capability; scope layering | **passes** |
| **discovery + `.pi/settings.json` curation** | `findPluginDirs` + `decidePluginPolicy` (`policy.js`); curation half unbuilt; **no `node` scope — use rule-keyed consumer identity over 2-layer fold** | **new-surface** | **m** (host-side) / design-ahead (agent) | **later** | curation-vs-policy split is sound | **breaks** (invented node scope; agent fold crosses WIT boundary) |
| **THE RECURSION** (agent-as-consumer live link) | `agent-tools-provider` exports → agent imports; **host-simulated today** | **build-from-zero** (Component Model composition + nested deny + linker merge) | **xl** | **first (prerequisite)** | the entire structural advantage; today asserted not demonstrated on the WASM path | **is the recursion** |
| **`ctx.exec` / in-process arbitrary JS** | _none — deliberately_ | **skip** | — | **skip** | rewriting raw runtime authority as a capability defeats the purpose | n/a |

---

## 4. Recommended FIRST slice

**Build the SKILL translator (`kind:"skill"` → `skill-contract-v1`), `priority: now`.** It is the single bridge that is **highest-payoff and lowest-cost, PASSES the recursion, and needs none of the design-ahead machinery.**

**Why this and not the recursion link first:** the recursion (§2) is the eventual prerequisite for _agent-targeting extension_ bridges (tool/command/gate). But it is an **xl build-from-zero** (Component Model composition + nested deny + linker merge). The SKILL bridge delivers immediate ecosystem convergence value (portable pi skills usable in refarm) **without** touching that machinery, because a skill is **data** — it flows through the already-consumer-agnostic `loadSkillsFromManifest` path and reaches the agent as instructions, not as a linked component. It **exercises and proves the front-half of the recursion** (surface → loader → consumer) on real corpus, de-risking fatia #C before the expensive back-half. Ship convergence value now; sequence the xl link deliberately.

**Files it touches (all non-§8, no protected surface):**
- `packages/plugin-surface-loader/src/` — add nothing structural; `loadSkillsFromManifest` (index.ts:97) and `DiscoveredSkill` (node.ts:66) already exist. The translator is a thin wrapper.
- The translator's mandatory must-dos (all trivial, all verified as real omissions): **inject `name = basename(dir)`** (no-name probe fails `STRING_EMPTY@$.name`), **normalize newlines** (refarm `parseFrontmatter` hard-requires `source.startsWith("---\n")` — CRLF/leading-whitespace hard-fails `FRONTMATTER_MISSING` while pi accepts it), **copy `SKILL.md` verbatim** for the sha256 pin, **emit `capabilities:[]`** (0/29 agents-lab skills declare any — the gate is latent).
- `packages/plugin-manifest/` is **§8-protected** — but **needs no change**: `kind` is already a free string and `{kind:"skill"}` is already a recognized surface (`index.d.ts:45`). **The first slice does not modify plugin-manifest, tractor, or `.project`.**

**Known narrow limit to flag as a pending-action (adhoc→complete maturity), not a blocker:** only **2/29** skills bundle executable siblings (`web-browser`: 10 JS; `git-checkout-cache`: 1 `.sh`). A faithful port must declare those as manifest `assets` + a read/exec capability the translator **cannot synthesize** — flag it. Executing a skill's scripts _inside_ the agent boundary is downstream and blocked on the same live composition (§2), not on this slice.

---

## 5. The 3–5 biggest gaps for full convergence (honestly ranked)

1. **The recursion / live dynamic plugin→plugin composition (§2).** No `wac`/`wasm-compose`/`InstancePre` in tractor; agent imports satisfied natively (`host.wit:108`); two unmerged linkers (`core.rs:125-127`); nested deny required (`agent-tools-provider` imports `host-spawn`); sandbox parity on the WASM path asserted, not demonstrated. **Every agent-targeting extension bridge waits on this.** xl.

2. **No dynamic agent-tool seam.** Even with composition, `tools_anthropic()` is a static in-binary array (`agent/src/lib.rs:100`) with a hardcoded dispatch — adding a _new_ agent tool is a **second** body of work (agent redesign) composition cannot reach. This is what makes `registerTool`'s differentiated half genuinely hard.

3. **No GATE/TRANSFORM routing on the event bus.** `on-event` is fire-and-forget (`integration.wit:36`); `plugin-host.ts` dispatch only fans `system:`-prefixed events and never reads a return. `respond` exists and is called (gated by `CAP_AGENT_RESPOND`) but **no host code routes an in-flight artifact through a discovered transform plugin's `respond`** — that layer is entirely unbuilt. This is where pi's imperative security (`tool_call{block:true}`) lives; refarm has only OBSERVE today.

4. **Non-standard-path / non-bearer providers are compiled-in Rust.** _Corrected:_ an unknown `base_url` **is** already accepted end-to-end via `MODEL_BASE_URL` (`wasi_bridge/core.rs:494`, proven by `extensibility_contract`). The real blocker is that the **API path** (`known_provider_api_path` core.rs:320, `_ => "/v1/chat/completions"`, **no env escape**) and the **auth family** (`use_anthropic_auth`/`bearer_key_for_provider` core.rs:256-296) are compiled-in match arms. A discovered plugin declaring a provider with a non-standard path or non-bearer scheme cannot cross the boundary declaratively without touching **tractor (§8-protected, serialized lock/handoff)**.

5. **`ctx.ui` has no analog and cannot be translated.** It is an in-process closure holding a live terminal handle — structurally incompatible with pure `run()` (`types.ts:28-33`). Bridging needs a net-new stateless declare→render→re-invoke "interaction envelope" renderer. Real architecture, correctly scoped as separate and optional.

---

## 6. What refarm should NOT try to converge

- **In-process arbitrary JS execution (`ctx.exec` / raw Node/Bun authority).** pi tools reach shell via `import {spawn} from "node:child_process"`, bypassing even `pi.exec` — **raw runtime authority by design** (`security.md` explicitly rejects a partial in-process sandbox as a false boundary). Rewriting this _as-is_ would import pi's exact anti-property. Refarm should offer the **capability-gated WASM boundary instead** and let tool authors rewrite — do not build a compatibility shim for un-sandboxed execution. **Skip.**
- **`disable-model-invocation` enforcement.** The flag survives verbatim in `manifest.frontmatter` (data preserved), but refarm has no hidden/explicit-only enforcement bit — and **0/29** skills declare it. The gap is latent for the entire corpus; **do not build enforcement speculatively.** Preserve the data, defer the semantics.
- **A third `node` ledger scope.** `LedgerScope` is a closed `"user" | "workspace"` union (`scope.ts:17`). Do **not** widen it to carry consumer identity — that belongs in the rule-data key over the real two-layer fold. Widening `LedgerScope` would require defining an undefined per-consumer `scopeRoot` fs-semantics and is the wrong mechanism.
- **Rebuilding the session model.** `session-contract-v1` + `storage-sqlite/session-v1.adapter` + `agent/src/session/*.rs` **already exist**. Do not "reify pi's session model from scratch" — the only real work is wiring the existing `SessionContractAdapter` over `NodeFsStorageProvider`/`openScopedLedger` + a per-cwd `listSessions` index. Effort **s**, not a net-new package.

---

_Verified at source: `plugin-manifest` free-string `kind` (index.d.ts:35, validate.js:125); `loadCheckersFromManifest` consumer-agnostic (index.ts:179-201); composition tooling absent (empty grep); `host.wit:108` native-simulation; two linkers (`plugin_host/core.rs:125-127`); `LedgerScope` closed union (`storage-fs/scope.ts:17,64`); session model pre-built (`session-contract-v1/`, `storage-sqlite/session-v1.adapter.ts`, `agent/src/session/`); deny-all sandbox runnable+tested (`quality-checker-ref/index.ts:49-116`); model path/auth compiled-in but base_url env-driven (`wasi_bridge/core.rs:256-332,494`)._