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

### D8. Both scopes exist, and the split is the one the workspace model already describes

Settled by the operator: there will be node automations and workspace automations, and neither is
a degenerate case of the other. The three known customers split cleanly — restarting THIS node and
verifying THIS node's rate catalog are node concerns; anything about the contents of a vault or a
repository is a workspace concern.

This is not a new axis. It is the adoption path the workspace taxonomy already records: a project
that carries no refarm config of its own is declared IN THE NODE's config so it can be operated at
all, and a project that has adopted refarm carries its own declaration. An automation follows its
subject. A nightly job about a vault that does not know refarm exists is declared on the node,
beside the workspace declaration that makes that vault reachable in the first place.

**The executor does not fork.** D1 stands: the node's loop runs everything, because the node is
the only thing running. What the scope changes is not who fires it but what governs it — and that
already exists. A workspace automation resolves its budget through the workspace level of D9's
three-level fold, which is the middle level that took until 2026-08-04 to bind anything at all.
Recurring workspace work is the consumer that makes that level earn its place: a vault sync that
runs every night is exactly the thing an operator wants to cap per workspace rather than per run.

A node automation resolves against the node level, as it does today.

**What still needs deciding, and it is smaller than the scope question was:** where a node
automation is written. `.project/automations.json` is a project file, and the governed writer
(`refarm project automations`) says so in its name. A node-scoped automation needs a node-scoped
home — most plausibly beside the sovereign config the node already reads — and the writer needs to
know which one it is addressing.

### D9. The workspace scope starts in refarm, because rcdc5's preconditions are not satisfiable yet

The operator proposed starting the workspace scope in either refarm itself or rcdc5, and was
sceptical, in his words, because rcdc5's operations need a VPN and sometimes a
user-plus-password-plus-MFA or a QR code — and "ephemeral automations are hard when control and
sovereignty are the long-term goal."

The scepticism is correct, and measurement makes it sharper than the intuition. **An automation is
only automatic if its preconditions can be satisfied without a human**, and rcdc5's cannot.

What already exists, measured:

- rcdc5's VPN is **already a declared, shell-free workspace command** (`vpn` in its commands
  allowlist), so invoking it is not the problem.
- The node can **already ask a human a question on whichever device they are holding** — the
  pending-prompt system works today, and its own test output shows answers arriving from
  `my-phone` and `delivery:pocket`.
- A non-terminal effort **already survives the process that created it**: `load_persisted_efforts`
  restores it at boot.

What does not exist, and these are the named prerequisites for rcdc5:

1. **A question that outlives its asker.** `packages/tractor/src/sidecar/pending_prompt.rs` states
   it as principle P1: *a pending prompt's lifetime is its asker's lifetime, nothing persists*.
   That is not an oversight to patch; it is a decision, and it is exactly what a nightly job
   blocked on an MFA push needs to be different. Either P1 is revisited or a second kind of prompt
   exists — durable, addressed to the operator rather than to a session. Without it, an automation
   that asks for MFA dies at the first restart between the push and the answer.
2. **Something that resumes a persisted non-terminal effort.** The state survives and nothing
   picks it up — the "ghosts" the safe-restart work reported are precisely this half-built. Until
   something resumes them, "waiting for a human" and "dead" are indistinguishable from outside.

So the workspace scope's first consumer is **refarm's own workspace**, whose automations —
verifying the rate catalog, checking runtime freshness, running `refarm health` — have
preconditions the node satisfies alone. Zero VPN, zero interactive auth, a real consumer, and the
executor proven before the hard case is attempted.

With both prerequisites in place, an rcdc5 automation becomes ordinary: run, call the already
declared `vpn` verb, suspend on the phone push, resume whenever the operator answers. That is not a
second path — it is what happens when the ephemeral parts are made durable, which is the operator's
stated requirement rather than a new mechanism.

### D10. An automation declares its preconditions, and the scheduler refuses what it cannot satisfy

The same rule D2 sets for a restart on a node with no supervisor, generalised, and it is what keeps
D9's honesty from depending on discipline.

An automation that needs something the node cannot provide unattended is **refused at scheduling
time, with the reason**, rather than accepted and left to fail at three in the morning into a log
nobody reads. A refusal an operator sees while declaring is worth more than a failure they discover
a week later, and it is the same three-state discipline everything else here follows: schedulable,
refused-with-reason, and undecidable — never a silent fourth state where it was accepted and simply
never worked.

## Open questions
- **Which cron parser?** No evaluator exists, and this repository is deliberately dependency-light. A standard cron expression is small to parse and easy to get subtly wrong (day-of-week versus day-of-month interaction is the classic). Vendoring a well-tested crate or package is likely better than hand-rolling, and the choice deserves the same source-and-date discipline every other external dependency here now carries.
**`daily-handoff` is settled, and it costs nothing.** The operator confirms the declaration is
vestigial. It is also already gone: `.project/automations.json` does not exist, so there is nothing
to delete — only test fixtures still name it. What survives is the IDEA, and it has a home: a daily
handoff makes sense in a private or collective vault workspace operated through refarm, which is a
workspace automation under D8 and a customer that does not exist yet.

So this spec carries **two** customers, not three. The rate verifier and the scheduled restart are
both node-scoped, which means the first implementation slice needs only the node scope — and the
workspace scope, whose only known customer is hypothetical, waits for a real one rather than being
built alongside.
