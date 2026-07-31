# Composable onboarding — and operating the node without being at it

Date: 2026-07-31
Status: Designed, not implemented
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — interfaces, devices and nodes
Builds on: [`2026-07-31-declaring-is-authoring-design.md`](2026-07-31-declaring-is-authoring-design.md)

## What forced this

The operator asked whether configuration and use are *consolidated and cohesive* — whether things
complete **by composition** rather than by someone remembering. Then they sharpened it:

> *"se tudo tiver coeso eu poderia usar um Wizard no termux para configurar o Telegram nesse
> computador aqui, sem precisar estar no computador. Quero me poupar ao máximo de ter que estar no
> computador para qualquer coisa."*

## The measured asymmetry

```
refarm resume --json   →  nextCommands: ["refarm task resume --json"]
refarm guide           →  writes refarm-audit.md
```

**The agent has a composition loop.** `resume`, `check --next-action`, and the `nextCommand`/
`nextCommands` handoff contract answer "where was I, what now" on every call.

**The operator gets a markdown report.** They read it, interpret it, and act by hand.

We built the composed handoff machine and offered it only to the AI. The sovereign operator got the
document. Meanwhile the wizards that exist — `init`, `sow`, `auth enroll`, `delivery add`,
`auth verify`, the kit's PATH operation — do not know about one another, and nothing answers "what is
missing for this to work".

Today things complete **by memory**, not by composition.

## R1 — Onboarding is derived, never a checklist

A checklist rots the moment someone adds a capability, and rots invisibly: it stays green. So each
capability **declares its readiness and what would satisfy it**, and onboarding is computed from
that. Declaring a new delivery channel, connection or workspace makes it appear in onboarding
without anyone editing a list.

## R2 — One handoff vocabulary, two audiences

`nextCommand`/`nextCommands` already exists, is tested, and has a CI lane. The operator's onboarding
consumes the same contract rather than inventing a parallel one for humans. Two vocabularies for one
concept is the duplication this repo has spent the day refusing.

## R3 — "Required to function" is not "available to adopt"

Onboarding must never tell the operator they *must* configure Telegram. It has to distinguish what is
**broken** from what is merely **not adopted**, or it becomes noise and noise gets ignored.

This is the ninth appearance of the same distinction in this codebase (`down` vs `unknown`, no-peers
vs could-not-ask, refused vs absent, delivered vs could-not-attempt). At this point it is not a
recurring surprise; it is the house rule recorded in
[the hardening signal](2026-07-30-hardening-signal-design.md).

## R4 — Remote initiation is the third piece, and two of three already exist

For a wizard to run from Termux and configure the node:

| piece | state |
| :-- | :-- |
| declared command catalog (`workspaces.*.commands`) | **exists** — `bfd3cc92`, "operation catalog, not shell" |
| prompts reaching the phone | **exists** — the hub plus `farm-attend`, verified live |
| **initiating** a command remotely | **missing** — no sidecar route, CLI only |

The security boundary is therefore already declared by the operator: a device could only invoke what
they allowed. This is not a new trust decision; it is connecting two things that already exist with
the brake already fitted.

## R5 — An operation declares its own remote invocability, and silence is closed

The bootstrap knot: to configure remotely, the command must be declared — and declaring is an edit
made at the computer. First time in person, everything after remote.

The knot dissolves once two things stop being conflated:

- **A declared workspace command is the operator's own argv** (`pnpm --filter … run vpn`). It needs
  an allowlist, because refarm cannot know what it does.
- **A refarm wizard is a known operation** — `delivery add`, `auth enroll`, `intention arm` — defined
  by refarm, with a known surface. It is not argv anyone supplied.

So an enrolled device may initiate refarm's own wizards; the operator's argv still requires the
allowlist. That was the operator's decision.

**The caveat, and its fix.** Some refarm operations should not be remotely invocable — revocation
being the obvious one. A deny-list is the tempting answer and the wrong one: it is correct only until
the next dangerous operation is added, and then it is silently wrong.

Instead **each operation declares whether it may be initiated remotely, and an operation that says
nothing may not.** Silence is closed, exactly as it is for `surfaces`, `delivery` and discovery. A
new dangerous operation is safe by default and becomes remotely invocable only when someone writes
that down — which is the moment a reviewer can ask why.

## First slice

The readiness declaration and derived onboarding over the existing `nextCommands` contract (R1–R3),
since it is what makes the rest legible; then remote initiation (R4, R5) with `delivery add` as its
first passenger — the operator configuring Telegram on the node, from the phone, having never opened
a terminal on the node.

## Not in this slice

Streaming a command's output to the initiating device. The wizard's *questions* are its interface,
and they already flow through the pending-prompt hub. Output beyond prompts is a separate problem and
pretending otherwise would smuggle a terminal multiplexer into this design.
