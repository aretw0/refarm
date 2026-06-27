# Reference Agent Driver Research

This note captures reference behavior from current agent drivers that Refarm
should learn from while staying lean and source-owned. It is not a feature
wishlist. A pattern only graduates into the daily-driver checklist when it can
be proved through a local command, a durable handoff, or a focused acceptance
script.

## Sources

- OpenAI Codex manual: https://developers.openai.com/codex/codex-manual.md
- Claude Code docs:
  - https://docs.anthropic.com/en/docs/claude-code/overview.md
  - https://docs.anthropic.com/en/docs/claude-code/hooks.md
  - https://docs.anthropic.com/en/docs/claude-code/sub-agents.md
  - https://docs.anthropic.com/en/docs/claude-code/memory.md
- Hermes Agent docs and repository:
  - https://github.com/NousResearch/hermes-agent
  - https://hermes-agent.nousresearch.com/docs
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/skills
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/cron
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks
- Pi docs and repository:
  - https://pi.dev
  - https://github.com/earendil-works/pi
  - https://github.com/earendil-works/pi/tree/main/packages/coding-agent
  - https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md
  - https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md
- Internal Pi/Refarm interop map:
  - `docs/superpowers/specs/2026-05-14-pi-refarm-interop.md`

## Reference Patterns

| Pattern | Reference signal | Refarm state | Refarm adoption rule |
| --- | --- | --- | --- |
| Hard lifecycle gates | Codex and Claude Code expose lifecycle hooks around tool use, sessions, permission requests, and stops. Hermes exposes gateway hooks, plugin hooks, and shell hooks; plugin `pre_tool_call` can veto a tool call. Pi keeps core permission UI minimal, but exposes trust decisions, tool allow/exclude flags, extension hooks, and containerization patterns. | Refarm has WIT host capabilities, `request-permission`, Scarecrow policy concepts, Barn integrity, tool audit, finish lanes, and an opt-in no-token policy smoke that proves allowlist, root boundary, trusted plugin, and audit together. | Keep policy as executable proof, not prompt convention. Next policy work should add denial-path and UI/operator surfacing only when a real daily-driver failure demands it. |
| Progressive capabilities | Codex skills and Hermes skills both use progressive disclosure. Hermes also supports skill bundles and agent-managed skills with optional write approval. Pi keeps the harness small and distributes workflow shape through extensions, skills, prompt templates, themes, and Pi packages from npm or git. | Refarm has plugins, tool manifests, runtime-agent tools, and package boundaries, but discovery is not yet a compact product surface. | Add a capability index only when it reduces prompt/context load. It must expose names, descriptions, requirements, and safety state without loading full instructions. |
| Durable memory | Claude Code uses persistent project instructions and auto memory. Hermes uses bounded `MEMORY.md` and `USER.md` snapshots plus session search. Codex uses AGENTS instructions and durable context. | Refarm has `.project/`, task checkpoints, Loro/SQLite memory, `resume` reads `.project/handoff.json`, the runtime-agent smoke proves task/session handoffs across a Tractor restart, and `refarm project handoff validate/write` governs project handoff updates. | Keep `.project/handoff.json` contextual recovery state. Treat write/validate as the explicit bridge from session knowledge into durable project state, not as implicit prompt memory. |
| Session portability | Claude Code and Hermes both emphasize moving across terminal, IDE, desktop, web, messaging, and background surfaces. Hermes uses one gateway process for many chat platforms. Pi stores JSONL sessions, supports continue/resume, tree navigation, fork/clone, HTML/JSONL export, RPC, SDK, and UI steering/follow-up while a run is active. | Refarm has CLI, app surfaces, runtime, sessions, stream observations, and JSON handoffs. | Prove the narrow local daily loop first: runtime up, ask, stream/session/task inspect, resume, finish. Add surfaces only after the contract survives restart and recovery. |
| Delegated workers | Codex subagents, Claude sub-agents, and Hermes `delegate_task` all isolate worker context and return summaries. Hermes defaults to bounded parallelism. | Refarm has runtime-agent and plugin execution primitives, but no first-class operator worker profile contract yet. | Defer broad agent teams until the single-agent daily loop is boring. When added, require explicit context packet, toolset, max concurrency, and summary schema. |
| Scheduled work | Claude Code and Hermes expose scheduled or recurring work. Hermes cron has one-shot and recurring jobs, skills per job, delivery targets, and fail-closed model pinning behavior. | Refarm has a governed Windmill local-scheduler SDK proof that materializes active automation triggers as owned no-token jobs with resume visibility; execution/daemon dispatch is still future work. | Keep the first proof local and cheap: one-shot and recurring no-token jobs, durable ownership, and clear resume/health visibility before timers or background dispatch. |
| Composable headless CLI | Codex, Claude Code, Hermes, and Pi all support non-interactive/headless flows. Pi adds print mode, JSON event mode, strict JSONL RPC, and SDK embedding. | Refarm JSON handoffs already make CLI commands scriptable. | Keep `ok`, `nextCommands`, and executable handoffs as the stable public contract; do not require the app for automation. |
| Checkpoints and rollback | Hermes documents checkpoints and rollback as a filesystem safety net for destructive operations. | Refarm has git discipline, finish lanes, checkpoints, and task/session resume, but rollback is not an operator product surface. | Treat rollback as a later hardening lane after policy denial and restart recovery are proven. It must never hide source changes from git. |
| External sandbox boundary | Pi explicitly does not restrict filesystem, process, network, or credential access by default; it recommends running the whole process in Docker/OpenShell or routing tools into a micro-VM through Gondolin. | Refarm is already designed around capability-gated WASM host calls and local resource discipline. | Keep Refarm stricter than Pi by default. When using external agents, document whether they are host-powerful, containerized, or routed through a Refarm-controlled capability boundary. |

## Source Refresh 2026-06-27

The references converge on a small driver nucleus rather than one big app:

- Codex makes progressive skills cheap by showing only a bounded skill index
  until a skill is selected. It also treats subagents as explicit, bounded
  context-isolation work, not automatic fanout.
- Claude Code separates memory from enforcement: `CLAUDE.md` and auto memory are
  context, while hooks and permissions are the hard control layer. Its subagents
  add independent context, tool access, permissions, model choice, and optional
  memory.
- Hermes Agent is strongest as an always-on gateway: one agent loop can serve
  terminal, messaging, memory search, skill evolution, delegates, and scheduled
  work. That is useful product pressure, but not a reason for Refarm to copy all
  surfaces before the local loop is dependable.
- Pi is the cleanest SDK/RPC reference. It keeps the terminal harness small,
  exposes interactive, print, JSON, RPC, and SDK modes, and lets packages supply
  workflow shape. Its permissive security stance is an explicit tradeoff that
  Refarm should not inherit by default.

## Refarm Driver Nucleus

The next product shape should be "Refarm as engine, CLI/app as shells":

1. Keep the operator loop as the hard daily-driver spine: `resume`, `check`,
   `ask`, stream/session/task inspection, `finish`, and project handoff.
2. Add a compact capability index before adding more skills, packages, workers,
   or UI affordances. The index should report name, description, provider,
   requirements, policy state, and activation command without loading full
   instructions.
3. Treat worker profiles as a public contract only after the single-agent loop is
   boring. A worker profile needs explicit context packet, allowed tools, model
   route, max concurrency, output schema, and cancellation/resume behavior.
4. Keep SDK/RPC shape close to Pi's useful boundary: Refarm packages should offer
   embeddable primitives so a downstream tool such as dgk can be powered by
   Refarm without being relabeled as Refarm.
5. Keep memory and policy separate. `.project/handoff.json`, AGENTS-style
   guidance, and future capability metadata are context. Scarecrow, Barn,
   WIT host capabilities, tool audit, and finish lanes are enforcement.

## Nearest Proving Slice

The next bite-sized slice that best unlocks the reference-driver path was a
capability discovery proof, not broad subagents or scheduler work:

1. Define the minimal capability descriptor schema in a package-owned source
   module.
2. Populate it from existing Refarm surfaces: runtime-agent tools, project
   handoff, finish lanes, policy/audit proof, and stream observation.
3. Expose one JSON command or SDK function that returns the compact index.
4. Add a handoff contract test so downstream consumers can rely on it without
   scraping docs or prompts.

This keeps the work aligned with Codex/Hermes progressive disclosure, Pi's
embeddable shape, and Claude's separation between guidance and enforcement,
while preserving Refarm's stricter capability boundary.

Current proof (2026-06-27): Refarm now exposes
`@refarm.dev/cli/capability-index` and `refarm capabilities --json`. The index
is intentionally static and cheap: it reports compact descriptors for proven
capabilities (runtime-agent ask loop, governed project handoff, finish lanes,
runtime shell policy audit, and stream observation subscriber), the governed
worker-profile SDK contract, and planned reference-driver gaps such as local
scheduled jobs. The CLI command supports tag and policy-state filtering, so
agents can ask for `--state planned --json` or `--state governed --json` without
scraping docs or loading long instructions.

Current proof (2026-06-27): `@refarm.dev/cli/worker-profile` defines the first
bounded worker contract: explicit context packet, allowed/denied tools, model
scope, max concurrency, output contract, and cancellation/resume policy. This
does not dispatch workers. It only gives downstream code and future runtime
work a small, validated shape to target before Refarm enables delegated
execution.

Current proof (2026-06-27): `@refarm.dev/windmill/local-scheduler` defines the
first local scheduled-work SDK boundary. It reads active `automation:v1`
artifacts with `once` or `cron` triggers, requires an explicit owner, marks due
jobs without starting timers, and returns no-token job handoffs with resume
visibility. This does not dispatch work. It gives Refarm and downstream
consumers a small governed surface before any daemon, fanout, or background
execution is introduced.

Current proof (2026-06-27): `refarm resume --json` has an operator-level slot
for scheduled-work inspection payloads. The CLI can now carry due/scheduled
local jobs in the same daily-driver handoff shape as runtime, model, project,
session, finish, and task state. Refarm still does not invent a scheduler store
or daemon in this layer; the next implementation can connect a real
`automation:v1` adapter without changing the resume contract.

Current proof (2026-06-27): the compact capability index now exposes the
runtime-agent primitives that matter for reference-driver parity instead of
hiding them inside prompt memory or source spelunking. `refarm capabilities
--tag reference-driver --json` returns the CRDT-backed session tree tools,
validated structured I/O tools, and LSP-shaped code-ops tools. This maps the
Pi/Hermes/Codex research into a cheap operator query while keeping dispatch,
policy, and UI promotion behind their existing proofs.

## Adoption Order

1. Keep the daily-driver loop first. The no-token runtime-agent path is proven;
   the remaining signal is sustained daily mileage and the `apps/me`/UI surface.
2. Keep the live policy bundle executable. The allowlist/root/trusted-plugin/audit
   proof is closed; denial surfacing can wait for a real operator failure.
3. Grow `.project/handoff.json` from governed handoff into a boring work-state
   primitive. Reading, freshness policy, and explicit write/validate are in
   place; remaining work is daily mileage and consumer adoption.
4. Add compact capability discovery only where it lowers context or removes
   duplicated consumer code.
5. Add worker/subagent profiles after single-agent reliability is high enough
   that parallelism does not multiply unresolved failures.
6. Keep scheduler execution behind the governed local-scheduler proof until the
   core loop can explain scheduled ownership through `resume`, `check`, or
   `health`.

## Non-Goals For Now

- Do not copy every surface from reference tools before the CLI loop is stable.
- Do not introduce broad worker fanout until Refarm has a hard concurrency
  policy and cheap local proof.
- Do not let hook or skill systems bypass Refarm policy. Self-improvement writes
  need reviewable staging when they affect durable project state.
- Do not require cloud, remote, or messaging surfaces for the primary local
  daily-driver path.
- Do not copy Pi's "no built-in permission popup" stance blindly. Refarm's
  product promise is a governed engine, so permissive host execution must be an
  explicit operator choice.
