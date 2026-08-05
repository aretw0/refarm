# What executes a declared automation

Date: 2026-08-05
Status: DESIGN. Findings measured; awaits the operator's review and then an implementation plan.
Touches `packages/tractor/**`, `packages/automation-contract-v1/**`, `apps/refarm/**`.
Opened by D2 of [`2026-08-04-instruments-for-the-four-shapes-design.md`](2026-08-04-instruments-for-the-four-shapes-design.md).

## What forced this

Three independent pieces of work arrived at the same missing part within one day.

| Wants scheduling | Why |
| --- | --- |
| The rate verifier | Vendor prices rot. Checking them by hand found seven wrong facts on 2026-08-04, every one only because a person happened to look. |
| Node restart | The operator asked to schedule it. A restart is now safe (SIGTERM, a bounded drain, an in-flight endpoint), and nothing fires it. |
| `daily-handoff` | Declared, reported by `refarm resume` as `scheduled`, executed by nothing. The operator did not recognise it: "não sei que daily-handoff é esse". |

The third is the oldest and the reason D2 named this question. `refarm resume` stopped claiming a scheduler exists; that made the gap honest without closing it.

## What already exists, measured

**The declaration language is complete.** `packages/automation-contract-v1/src/types.ts` carries `CronTrigger` with a standard cron expression, plus `OneShotTrigger`, `EventTrigger` and `ManualTrigger`; bodies come in `StaticBody`, `TemplateBody` and `PluginBody`; an `Automation` is a `ManagedArtifact` with a lifecycle status and a filter. Nothing is missing from the vocabulary.

**A governed writer exists.** `refarm project automations validate | list | add | set-status` writes `.project/automations.json` through the same discipline `handoff write` uses.

**Nothing evaluates any of it.** No cron parser exists anywhere in the tree — the only files mentioning `cron` are the type declarations and their tests. Today the question "is this automation due?" cannot be answered at all, by anything.

**The daemon has no periodic loop.**

**A supervisor pattern is already in use on this node.** `~/.config/systemd/user/refarm-web-serve.service` runs with `Restart=always` and `RestartSec=5`. The tractor daemon is not under it, and was started by hand.

## The design

### D1. The node's own loop is the executor

The daemon is the only thing that is already running, already holds the effort store, already resolves budgets, and already writes observations. An automation run is an effort; giving it a second execution path would give it a second set of answers about what it cost and whether it was governed.

Cron ticking in the daemon also keeps this sovereign and offline: no external scheduler, no cloud, no assumption that a machine is reachable. That matters more here than anywhere, because the whole point is a node that keeps its own commitments.

**A GitHub Actions schedule was considered and rejected as the general answer**, though it remains fine for repository-scoped chores. It cannot restart a node, it cannot see a node's config, and it makes a sovereign node's routine depend on a service the node does not own.

### D2. A restart automation is "drain and exit", and a supervisor brings the node back

A daemon cannot execute an automation whose action is to restart that daemon. Rather than invent self-restart machinery, the automation's action is to drain and exit — which is now a real, bounded operation — and a supervisor with `Restart=always` starts it again. The operator already runs exactly this arrangement for `refarm web serve`.

This makes the restart automation *smaller* than the alternatives, not larger, and it is the reason the safe-restart work had to land first.

**Consequence to state plainly:** on a node with no supervisor, a restart automation must REFUSE to be scheduled rather than exit and leave the node down. Checking for a supervisor before accepting the schedule is part of this slice, not a later hardening.

### D3. A run is an effort, and inherits everything an effort has

An automation run dispatches through the same path a manual one does, so it carries a resolved budget on all three axes, produces a `BudgetObservation` with `host.name`, `elapsed_ms`, tokens and cost, and is bounded by a deadline. Nothing new is needed for an automation to be governed; it is governed by being an effort.

This is also what makes the rate verifier affordable to schedule: its cost is measured, capped, and attributable to a named node, from the first run.

### D4. Three states for "is it due?", never two

A cron expression that cannot be parsed must not be treated as "not due". It is `undecidable`, and an automation in that state is reported to the operator and never fires. Silently never firing is exactly the `daily-handoff` failure that opened this question, and rebuilding it inside its own fix would be the joke this repository keeps refusing to make.

### D5. A missed window is skipped, and said out loud

When a node was off while an automation was due, the run is skipped rather than caught up. A week offline must not produce a week of backlog on boot, and for the three known customers a late run has no value: a rate check wants the current page, a restart wants now.

Skipping is only acceptable because it is REPORTED. A skipped window is recorded with its due time, so an operator can see that the node did not keep a commitment rather than assume it did.

### D6. Automations become a capability, so every surface reaches them the same way

Added after the operator asked whether the architecture supports automations being reachable
from the agent, the TUI and other surfaces. Checking rather than answering found a gap in
everything above: **this spec designed the EXECUTOR and said nothing about REACH, and they are
orthogonal axes.**

Measured today: an automation is an `AutomationAdapter` (a TypeScript interface), a CLI command,
and a JSON file. It is not a verb. The agent reaches other functionality through the
`capability-tools` seam, where tools are named `<plugin>_<verb>` — so with no verb, the agent
cannot list, inspect or trigger any automation, a TUI would need bespoke wiring, and every new
surface would re-wire from scratch.

The repository already has one answer for "reachable from every surface", and it is not a new
one: be a capability with verbs, and let surfaces render verbs. `refarm dispatch <plugin> <verb>`,
the homestead and terminal surfaces, and the agent's own tool list all consume that same shape.

So automations get verbs — list, inspect, trigger, and the lifecycle transitions the
`ManagedArtifact` status already defines — and executor and reach stop being the same question.
The node's loop fires a due automation; a surface fires the same one on request; both dispatch the
same effort, and D3 means both are governed and recorded identically.

### D7. An agent that can trigger automations can restart the node it is running on

This falls directly out of D6 and must be designed in rather than discovered later.

Once automations are verbs and the agent can invoke verbs, the set of things a model can decide to
do includes "restart this node" — the automation D2 makes possible. That is not a reason to
withhold the reach; an operational agent that cannot operate is not the goal. It is a reason for
the trigger verb to be permissioned rather than ambient.

The machinery exists: `plugin.json` already declares `permissions` and a `trust.profile`, and
`packages/scarecrow-plugin` is the policy surface. What this design must not do is expose a
trigger verb that inherits whatever permission the caller happens to have, because the honest
question is not "may this plugin act" but "may this caller cause THIS automation to run" — and a
restart, a spend, and a read are not the same answer.

The narrow rule this spec commits to: **an automation declares what triggering it requires, and a
surface that cannot satisfy that requirement is told so rather than silently offered a button that
fails.** Which requirements exist, and whether they are per-automation or per-body-kind, belongs
with the verb×object credential scope already queued ahead of the budget spec's later slices.

## What this deliberately does not do

**No catch-up policy per automation.** D5 picks one behaviour for every automation. A `catchUp: true` option is easy to add and impossible to remove, and none of the three known customers wants it. If a fourth arrives that genuinely does, its need will describe the option better than a guess can.

**No new scheduling vocabulary.** The contract already has more trigger kinds than this slice will implement. Implementing `CronTrigger` and `OneShotTrigger` covers all three customers; `EventTrigger` waits for a customer, and adding an executor for a trigger nobody fires is the written-correct-and-unreachable shape this repository has now catalogued seven times in two days.

## Open questions

- **Are automations node-scoped or project-scoped?** The writer produces `.project/automations.json`, which is project-scoped, and `refarm project automations` says so in its name. But two of the three customers are node concerns: restarting THIS node, and verifying rates for THIS node's catalog. A project-scoped file cannot express "this node restarts nightly" without the project being pinned to a node. This needs settling before implementation and it overlaps the workspace question the hatch spec owns.
- **Which cron parser?** No evaluator exists, and this repository is deliberately dependency-light. A standard cron expression is small to parse and easy to get subtly wrong (day-of-week versus day-of-month interaction is the classic). Vendoring a well-tested crate or package is likely better than hand-rolling, and the choice deserves the same source-and-date discipline every other external dependency here now carries.
- **What does `daily-handoff` want to be?** It is the oldest customer and the operator does not recognise it. It may be vestigial, in which case deleting the declaration is the honest close, and this spec should not carry a customer nobody claims.
