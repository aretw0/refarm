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

## Reference Patterns

| Pattern | Reference signal | Refarm state | Refarm adoption rule |
| --- | --- | --- | --- |
| Hard lifecycle gates | Codex and Claude Code expose lifecycle hooks around tool use, sessions, permission requests, and stops. Hermes exposes gateway hooks, plugin hooks, and shell hooks; plugin `pre_tool_call` can veto a tool call. | Refarm already has WIT host capabilities, `request-permission`, Scarecrow policy concepts, Barn integrity, tool audit, and finish lanes. | Promote policy from prompt convention to a live acceptance bundle: tool allowlist, root boundary, trusted plugin, audit record, and denial proof in one focused run. |
| Progressive capabilities | Codex skills and Hermes skills both use progressive disclosure. Hermes also supports skill bundles and agent-managed skills with optional write approval. | Refarm has plugins, tool manifests, runtime-agent tools, and package boundaries, but discovery is not yet a compact product surface. | Add a capability index only when it reduces prompt/context load. It must expose names, descriptions, requirements, and safety state without loading full instructions. |
| Durable memory | Claude Code uses persistent project instructions and auto memory. Hermes uses bounded `MEMORY.md` and `USER.md` snapshots plus session search. Codex uses AGENTS instructions and durable context. | Refarm has `.project/`, task checkpoints, Loro/SQLite memory, and `resume` now reads `.project/handoff.json`. | Define the write policy for `.project/handoff.json`: who may update it, when it becomes canonical work state, and which command validates freshness. |
| Session portability | Claude Code and Hermes both emphasize moving across terminal, IDE, desktop, web, messaging, and background surfaces. Hermes uses one gateway process for many chat platforms. | Refarm has CLI, app surfaces, runtime, sessions, stream observations, and JSON handoffs. | Prove the narrow local daily loop first: runtime up, ask, stream/session/task inspect, resume, finish. Add surfaces only after the contract survives restart and recovery. |
| Delegated workers | Codex subagents, Claude sub-agents, and Hermes `delegate_task` all isolate worker context and return summaries. Hermes defaults to bounded parallelism. | Refarm has runtime-agent and plugin execution primitives, but no first-class operator worker profile contract yet. | Defer broad agent teams until the single-agent daily loop is boring. When added, require explicit context packet, toolset, max concurrency, and summary schema. |
| Scheduled work | Claude Code and Hermes expose scheduled or recurring work. Hermes cron has one-shot and recurring jobs, skills per job, delivery targets, and fail-closed model pinning behavior. | Refarm has Windmill/scheduler intent, but the daily-driver checklist row is still unproven. | First proof should be local and cheap: one-shot and recurring no-token jobs, durable ownership, and clear resume/health visibility. |
| Composable headless CLI | Codex, Claude Code, and Hermes all support non-interactive/headless flows. Hermes also exposes library and API-server paths. | Refarm JSON handoffs already make CLI commands scriptable. | Keep `ok`, `nextCommands`, and executable handoffs as the stable public contract; do not require the app for automation. |
| Checkpoints and rollback | Hermes documents checkpoints and rollback as a filesystem safety net for destructive operations. | Refarm has git discipline, finish lanes, checkpoints, and task/session resume, but rollback is not an operator product surface. | Treat rollback as a later hardening lane after policy denial and restart recovery are proven. It must never hide source changes from git. |

## Adoption Order

1. Keep the daily-driver loop first. The current blocking proof is still the
   live runtime-agent path: `runtime up -> ask -> stream/session/task inspect ->
   resume -> finish`.
2. Close the live policy bundle next. This is the shared foundation for Refarm,
   `dgk`, `vault-seed`, and future app surfaces.
3. Make `.project/handoff.json` a governed work-state primitive. Reading is now
   proven; writing and freshness policy are not.
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
