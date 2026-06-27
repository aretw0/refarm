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
| Durable memory | Claude Code uses persistent project instructions and auto memory. Hermes uses bounded `MEMORY.md` and `USER.md` snapshots plus session search. Codex uses AGENTS instructions and durable context. | Refarm has `.project/`, task checkpoints, Loro/SQLite memory, `resume` reads `.project/handoff.json`, and the runtime-agent smoke proves task/session handoffs across a Tractor restart. | Keep `.project/handoff.json` governed contextual recovery state until a first-class checkpoint writer exists. The next memory primitive is explicit handoff write/validate, not implicit prompt memory. |
| Session portability | Claude Code and Hermes both emphasize moving across terminal, IDE, desktop, web, messaging, and background surfaces. Hermes uses one gateway process for many chat platforms. Pi stores JSONL sessions, supports continue/resume, tree navigation, fork/clone, HTML/JSONL export, RPC, SDK, and UI steering/follow-up while a run is active. | Refarm has CLI, app surfaces, runtime, sessions, stream observations, and JSON handoffs. | Prove the narrow local daily loop first: runtime up, ask, stream/session/task inspect, resume, finish. Add surfaces only after the contract survives restart and recovery. |
| Delegated workers | Codex subagents, Claude sub-agents, and Hermes `delegate_task` all isolate worker context and return summaries. Hermes defaults to bounded parallelism. | Refarm has runtime-agent and plugin execution primitives, but no first-class operator worker profile contract yet. | Defer broad agent teams until the single-agent daily loop is boring. When added, require explicit context packet, toolset, max concurrency, and summary schema. |
| Scheduled work | Claude Code and Hermes expose scheduled or recurring work. Hermes cron has one-shot and recurring jobs, skills per job, delivery targets, and fail-closed model pinning behavior. | Refarm has Windmill/scheduler intent, but the daily-driver checklist row is still unproven. | First proof should be local and cheap: one-shot and recurring no-token jobs, durable ownership, and clear resume/health visibility. |
| Composable headless CLI | Codex, Claude Code, Hermes, and Pi all support non-interactive/headless flows. Pi adds print mode, JSON event mode, strict JSONL RPC, and SDK embedding. | Refarm JSON handoffs already make CLI commands scriptable. | Keep `ok`, `nextCommands`, and executable handoffs as the stable public contract; do not require the app for automation. |
| Checkpoints and rollback | Hermes documents checkpoints and rollback as a filesystem safety net for destructive operations. | Refarm has git discipline, finish lanes, checkpoints, and task/session resume, but rollback is not an operator product surface. | Treat rollback as a later hardening lane after policy denial and restart recovery are proven. It must never hide source changes from git. |
| External sandbox boundary | Pi explicitly does not restrict filesystem, process, network, or credential access by default; it recommends running the whole process in Docker/OpenShell or routing tools into a micro-VM through Gondolin. | Refarm is already designed around capability-gated WASM host calls and local resource discipline. | Keep Refarm stricter than Pi by default. When using external agents, document whether they are host-powerful, containerized, or routed through a Refarm-controlled capability boundary. |

## Adoption Order

1. Keep the daily-driver loop first. The no-token runtime-agent path is proven;
   the remaining signal is sustained daily mileage and the `apps/me`/UI surface.
2. Keep the live policy bundle executable. The allowlist/root/trusted-plugin/audit
   proof is closed; denial surfacing can wait for a real operator failure.
3. Make `.project/handoff.json` a governed work-state primitive. Reading and
   freshness policy are now documented; a first-class write/validate command is
   still open.
4. Add compact capability discovery only where it lowers context or removes
   duplicated consumer code.
5. Add worker/subagent profiles after single-agent reliability is high enough
   that parallelism does not multiply unresolved failures.
6. Add scheduler proof after the core loop can explain scheduled ownership
   through `resume`, `check`, or `health`.

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
