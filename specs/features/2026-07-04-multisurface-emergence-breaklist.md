# Multi-surface emergence — the break-list

**Status:** Mapped (workflow `wf_ead8e694-872`, 10/12 agents source-verified; 2 lifecycle agents hit a retry cap but the synth had the rest). The ordered list of seams to break so a plugin declared ONCE reflects across cli/tui/web/repl/agent.

## The central finding

**The contract is already right; emergence is blocked at the PROJECTOR/READER layer, not the contract layer.** `CapabilityDescriptor` (capabilities/types.ts:35) is a neutral core (name/summary/args + a pure `run(input)→CapabilityEnvelope`) plus two OPEN maps — `transports` (how invoked: cli/repl/http) and `renderers` (how shown: web/tui) — both `[key:string]`-open so a new surface is additive. This is the correct "declare once → N surfaces" shape and it is conformance-tested.

But **every lifecycle scored declareOnce=FALSE**: the REALIZED contract is "declare-once-project-to-TWO-surfaces-BY-HAND" (CLI + REPL, each wired in a separate place), and **4 of 6 declared buckets have ZERO readers** (`transports.http`, `renderers.tui`, `renderers.web`, and the not-yet-declared `agent`). The hints are declared uniformly across skill/model/quality; only the readers are missing.

Two diseases, repeated identically across skill/model/quality:v1/extension-review:
1. **Double-registration**: each verb is hand-mounted in program.ts AND registered into capabilityRegistry (program.ts:229/232 + capability-registry.ts:67-69). The REPL (chat.ts) already derives from the registry; only the CLI doesn't.
2. **Missing projectors**: no HTTP/TUI/web loop over `registry.list()`.

## The north star

One CapabilityDescriptor, declared ONCE, registered ONCE, and every surface is a generic PROJECTOR that reads only its own bucket off `registry.list()`: commander reads `transports.cli`, REPL reads `transports.repl`, HTTP reads `transports.http`, web/tui shells read `renderers.web/tui`, and a Rust agent-tools bridge reflects each pure `run()→envelope` across the WIT boundary as an agent tool. The evaluator family becomes ONE PolicyEvaluator instance registered as its own CapabilityGroup. The terminal recursion — a plugin extends another plugin including the agent without privilege — closes when (a) a plugin registers its own CapabilityEntry through a host `register()` path and inherits all projectors, and (b) tractor Component-Model composition lets a discovered provider component satisfy the agent's imports.

## Ordered break-list (by leverage)

| # | Break | Effort | §8 | Unblocks |
|---|---|---|---|---|
| **1** | **program.ts drives CLI from `capabilityRegistry.list()`** via toCommanderGroup, deleting hand-mounts (program.ts:229/232, extension.ts:438). Registration becomes the ONE declaration point. | M | no | declare-once CLI+REPL for skill/model/quality/extension-review; any future/plugin CapabilityGroup lights up on both; removes the per-verb second edit forever. **THE substrate every later break stands on.** |
| 2 | Honor `transports.cli.group` + `directAlias` inside toCommanderGroup (capability-commander.ts:108/37) — today decorative | S | no | plugin grouped verbs auto-place under parents; top-level aliases from one declaration |
| 3 | Write the 3 missing projectors (HTTP `transports.http`, TUI `renderers.tui`, web `renderers.web`), each ONE loop over `registry.list()`; wire web/tui through homestead host-renderer slot | L | no | http/tui/web for EVERY registered capability at once; evaluator findings ride the same buckets |
| 4 | Extract PolicyEvaluator contract generalizing quality-contract-v1 QualityChecker: `evaluate(subject, profile)→Finding[]` over an open domain; quality:v1 as first instance (adapter). Add a profile surface-kind loader (rules-as-data), replace hardcoded SKILL_TELLS_PROFILE. Register evaluator as its own CapabilityGroup (`check <domain> <subject>`). | L | no | evaluator as declare-once verb; plugin profiles auto-appear; health/security/ds-lint through one contract |
| 5 | Open a host `register()` PATH into capabilityRegistry for loaded plugins; move render/exit hooks ONTO the descriptor (not the app-side side-Map) | M | no | plugin-declared capabilities on all TS surfaces from ONE registration; plugin-extends-plugin for the data/verb path (no §8) |
| 6 | Add `agent` key to CapabilityTransports + Rust agent-tools→registry WIT bridge reflecting each pure `run()→envelope` as an agent tool | L | **§8** | agent leg of skill/capability/evaluator/theme; agent-as-control-plane; read/data path of plugin-extends-agent |
| 7 | Wire skill runtime-invoke (stages 6-7) behind activation preflight as `skill invoke <id>` | M | no | skill#3 loop closes; agent executes approved skill plans |
| 8 | Fold theme into the capability foundation: `themeToCss(theme,id)` in ds + registry-aware host resolver | M | no | plugin theme-packs paint web; theme list/use on all surfaces; white-label default-theme |
| 9 | Tractor Component-Model composition (from zero — no wasm-compose/wac in tractor) + merge the two unmerged linkers | L | **§8** | true non-privileged plugin→plugin; plugin-contributed agent tools |

## task.ts: NO — leave it

task.ts is the runtime-EFFORT dispatcher (run/status/logs/resume over file/http/channel adapters that submit an Effort to tractor). It is NOT a CapabilityDescriptor: its `run()` BUILDS an Effort (task.ts:207-220), which the capability contract explicitly forbids (types.ts:28-33). It is the effort-SUBMITTER the pure capabilities are defined against — structurally on the other side of the boundary, and the surface the agent bridge (#6) will TARGET, not a verb to project. Breaking it advances nothing break #1 doesn't already deliver. Leave it (confirms the earlier SKIP, now with an architectural reason).

## health-policy → evaluator: adapter-first (does NOT duplicate)

quality-contract-v1 ALREADY EXISTS and is the ONE real declare→sandbox→evaluate shape (`QualityChecker.check(subject,profile)→QualityFinding[]`, `runQualityCheck→QualityReport`). policy-contract-v1 is pure DATA (RetentionPolicy/QuotaPolicy, no evaluate()) — NOT an evaluator, don't touch. health-policy.ts is a CONFIG-PRESET resolver (the auditor's INPUT, not an evaluator stage).

**First slice:** a thin adapter wrapping the health FileSystemAuditor/ComplexityAuditor as a QualityChecker instance (checkerId:'health', domain:'repo', profile derived from resolveHealthPolicy), reusing the REAL `runQualityCheck` to produce the canonical QualityReport — which today has ZERO production callers, so this also revives the dead canonical path. Proves the generalization on a SECOND family before extracting the formal contract. health becomes ONE checker among plural (quality:v1 skill-tells, ds-lint, future security/text-tells); the verb stays domain-neutral. NOT in slice one: the profile surface-kind loader and the formal policy-evaluator-contract-v1 package (those follow once the shape is proven).

## Open decisions for Arthur (see AskUserQuestion)

1. §8 gate for breaks #6 (agent bridge) + #9 (composition) — authorize + order?
2. Evaluator scope: health IN, channel-policy OUT (distinct validator, not evaluator)?
3. Contract-first vs adapter-first for the evaluator?
4. Naming de-collision ('CapabilityDescriptor'/'policy' have 4 meanings) — dedicated slice before projectors, or defer?
5. Theme as a capability verb vs standalone subsystem referenced via renderer hints?
