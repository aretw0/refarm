# Process administration — one layer, four models to reconcile

Date: 2026-07-29
Status: Designed; only the boundary consolidation is in scope for implementation now
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — machine empowerment / operate-model

## Why

The operator states the requirement plainly: they will administer processes. Some are long-lived,
some are not, some belong to the plugin they came from. What matters is administering them **well,
with sovereignty of organisation and architecture — no lean-to additions.**

Today refarm has **four partial models of "a process"**, each grown from a different pain, and none
of them is that layer:

| Where | What it captures | What it cannot see |
| --- | --- | --- |
| `@refarm.dev/process-handoff` | display, handoff, detached-with-log; `inherit` vs `capture` | timeout, output cap, isolated env, group kill, spawn-error-as-result |
| `@refarm.dev/cli/command-plan` | **resource governance** — `workClass`, ceilings, concurrency (the 8GB-host problem, ADR-078) | lifetime, owner, state |
| `@refarm.dev/login-flow` | **conversation** with a process, and supervision | sharing, catalog, declared policy |
| the connection registry (Rust) | a **named shared resource** — claims, probe-decided state, linger | it is only "connection", and it lives in the host, invisible to the CLI |

The immediate symptom is an architecture test that has been red on `develop` since before this work:
`apps/refarm/test/architecture/process-boundary.test.ts` forbids `node:child_process` anywhere in
the app, and both `commands/workspace.ts` and `commands/connection.ts` import it. They import it
**because `process-handoff` lacks the guarantees they needed**, so each grew its own copy. That is
the lean-to, and the red test is the alarm that already knew.

One fact makes the repair cheap: `connection.ts` recently implemented every missing guarantee
correctly — a timeout, a 1 MiB output cap byte-identical to the host's, environment isolation
matching `env_clear`, and spawn errors returned as a result rather than thrown. **The correct
implementation already exists; it is simply in the wrong layer.**

## What others already solved

The operator asked not to reinvent. Six lessons are directly transferable; the third is the one that
hurts.

1. **Kubernetes separates three probes — startup, readiness, liveness.** Refarm built *readiness*
   (D1b). Supervision needs *liveness*: "is it still alive and should it be restarted?" is a
   different question from "is it ready?". Conflating them is the classic outage — a slow-starting
   process killed by a liveness probe before it ever became ready.
2. **systemd separates `Requires=` (dependency) from `After=` (ordering).** Two axes, not one.
   That is exactly the question deferred in the connections design (a SerproID session that needs
   the VPN up first). Take the distinction, not the implementation.
3. **systemd rate-limits starts** (`StartLimitBurst` over `StartLimitIntervalSec`) and puts a unit
   that keeps failing into a terminal `failed` state that requires an explicit reset. This is
   precisely the operator's lived failure — three phone approvals burned in six minutes — solved
   generically decades ago. D13 (park in `needs-attention` and wait for the human) is the
   attention-aware version of the same instinct; a start-rate limit is its cheap complement for the
   cases where no human is involved.
4. **systemd's `Type=notify` versus polling.** A process that announces its own readiness is more
   precise than a probe — but it requires the process to cooperate, and `ovpnctl` never will. So the
   probe was the right choice **for foreign binaries**, and that deserves recording as a reason
   rather than an accident. Where refarm owns the process (its own plugins), a notify-style
   readiness channel is strictly better and remains open.
5. **s6/runit keep supervision separate from dependency management.** Two mechanisms, deliberately
   not welded together, because welding them makes both harder to reason about.
6. **Kubernetes `ownerReferences` and its garbage collection.** The connection registry's claims are
   exactly ownerReferences, and `release_owner` (a plugin unloads ⇒ its claims vanish) is exactly
   owner-triggered GC. Refarm arrived at this independently; naming the correspondence tells us what
   to copy next.

The broader finding: **the connection registry is converging, unknowingly, on the systemd/Kubernetes
model** — a named resource with an owner, a declared policy, and state decided by probing. Naming
that convergence is what lets the next step be assimilation rather than invention.

## Decisions

### P1 — One process boundary in TypeScript, and the app never crosses it

`@refarm.dev/process-handoff` is the boundary. `apps/refarm/src` never imports `node:child_process`
— the architecture test is right and stays as it is. The boundary grows the guarantees its callers
actually need, rather than each caller growing its own:

- a **timeout** that settles the call (the async runner has none today; only the sync one honours it);
- an **output cap** matching the host's 1 MiB, with the same truncation marker;
- **environment isolation** — run with exactly the environment given, mirroring the host's
  `env_clear().envs(env)`, so a CLI-side result and a host-side result cannot diverge on inherited
  variables;
- **process-group kill**, so a wrapper's grandchildren die with it instead of orphaning;
- **spawn failure as a result, not an exception**, so a caller can distinguish "it ran and said no"
  from "I could not run it" — the distinction that keeps `down` and `unknown` apart.

These are moved down from `connection.ts`, where they are already implemented and tested, not
written afresh.

### P2 — Three lifetime classes, named now, generalised later

Every process refarm administers falls into one of three classes. Naming them now is free; building
a generic registry for them is not, and is deferred (P9).

- **one-shot** — runs, produces a result, ends. Bounded by a timeout. `workspace run`'s commands,
  probes, package-manager invocations.
- **held** — runs and is *supposed* to outlive the call, because its running IS the resource: a VPN
  client holding a tunnel, a logged-in session. Ends by explicit stop, by its owner going away, or
  by policy.
- **supervised** — held, plus something watches it and re-establishes it. Not built; gated on P3
  and P5.

A class is a property of the *declaration*, never inferred from behaviour. Inferring it is how a
one-shot that happens to be slow gets treated as held.

### P3 — Readiness, liveness and startup are three questions

Refarm has readiness. Before supervision is built, the other two must be distinct concepts, because
retrofitting the distinction after a supervisor exists means changing what "the probe" means
everywhere.

- **startup** — has it finished coming up? Bounds the establish attempt; today's `readyTimeoutMs`.
- **readiness** — can it serve? Today's probe. Decides `up`.
- **liveness** — is it still alive, and should it be re-established? Needed only by supervision.

They may share one probe command when the operator declares only one, but the *questions* stay
separate, and a supervisor must never use the startup answer to decide a restart.

### P4 — Dependency and ordering are separate axes

When connection B needs connection A (a SerproID session over the VPN), that is two statements:
"B requires A" and "A must be established before B". Refarm will express them as separate fields
when the second connection exists, not as one `dependsOn` that silently means both. Cycle detection
belongs with the dependency axis.

### P5 — A failing establish must rate-limit itself and reach a terminal state

Independent of D13's human-attention gate, and complementing it: repeated establish attempts must be
bounded by a rate, and a connection that exhausts it enters a terminal failed state that requires an
explicit operator reset rather than continuing to retry.

D13 covers the case where a human is on the critical path (park and wait — an unacknowledged request
never expires). P5 covers the case where none is: a probe that never succeeds, a binary that always
exits non-zero. Without P5 those retry forever; without D13 the human-dependent ones burn the
operator's attention. **Both are needed, and they are not the same rule.**

### P6 — Probe for foreign binaries; notify stays open for refarm's own

Recorded so the choice is not re-litigated: polling a probe is right for a binary refarm does not
control. For processes refarm does own — its own plugins, its own daemons — a notify-style readiness
channel is more precise and remains an open option, not a rejected one.

### P7 — Ownership is a claim, and a dead owner collects its claims

Already implemented for connections; stated here as the layer's rule. Whatever asks for a process
holds a claim; when the claimant goes away, the claim goes with it. Whether the *process* falls is
the declaration's policy, never the claimant's choice.

### P8 — Resource governance is a separate axis from lifetime

`command-plan`'s `workClass` and ceilings answer "how much of this machine may this consume, and
should it degrade, serialise or refuse?" That is orthogonal to lifetime, owner and readiness.
Following s6's lesson, the two stay separate mechanisms that compose, rather than one model that
does both badly.

### P9 — The generic registry waits for a second long-lived kind

There is exactly one kind of held process today: connections. The repo's own guardrail is to
assimilate a generic capability only under real second-consumer pressure. So the generic process
registry is **designed here and not built**. The trigger is concrete: a second held kind — a scraper
daemon, a browser session held across calls, or a plugin's own worker.

When it arrives, the connection registry is the template, not the special case: rename the concept,
keep claims, probes and linger, and add the class field from P2.

## In scope now

Only P1 — the boundary consolidation. Concretely: grow `process-handoff` with the five guarantees,
move `apps/refarm/src/commands/workspace.ts` and `commands/connection.ts` onto it, and let the
architecture test go green by being obeyed rather than amended.

Two constraints on that work, both learned the hard way in this repo:

- The moved code must keep the host-parity it already has — the 1 MiB cap and the truncation marker
  are byte-identical to `packages/tractor/src/host/host_effects_bridge/core.rs`, and environment
  isolation mirrors `env_clear`. A consolidation that loosens either re-opens the CLI-versus-host
  disagreement that was just closed.
- `workspace run` is **interactive** — it inherits stdio so an operator answers prompts and sees a
  push notice live. The boundary already supports that shape (`capture: false` ⇒ `stdio: "inherit"`);
  the timeout and cap must apply only to the captured shape, or an interactive command would be
  killed mid-login.

## Out of scope

P2's registry, P3's liveness probe, P4's dependency fields, P5's rate limiter, and P6's notify
channel are named, not built. Each has a trigger: P3 and P5 when supervision is built; P4 when a
second connection needs the first; P2/P9 when a second held kind appears; P6 when refarm supervises
a process it owns.
