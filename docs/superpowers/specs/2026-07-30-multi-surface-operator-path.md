# The path to a multi-surface operator, in the order that pays soonest

Date: 2026-07-30
Status: Path, not a plan — each slice gets its own design when taken
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — interfaces, devices and nodes

## What this answers

The operator asked to know *"que caminho de implementação trilhar para cobrir essas lacunas e
aproveitar as potências"* — the gaps being notifications, a systray, a localhost web view, and
enrolment initiated from the phone; the potentials being what is already built and paid for.

The ordering below is not the order the gaps were named. It is the order in which each slice is
usable on its own and makes the next one cheaper.

## What is already paid for

Naming these first, because the path is mostly about spending them rather than building anew:

- **`OperatorChannel` is surface-neutral.** `packages/prompt-contract-v1` has `stdio`, `scripted`
  and `auto` today, and none of them is privileged in the contract. A fourth adapter is an adapter,
  not a redesign. Its conformance suite (`runOperatorChannelConformance`) means a new channel has to
  *prove* it behaves, including cancellation — added today, after a channel that did not.
- **The registry seam is proven, not theoretical.** `apps/refarm/src/commands/identity-sources.ts`
  shipped today: a new source is one file plus one line, and the canonical flow never learns it
  exists.
- **A declared surface can already bind to the tailnet with a device gate.** `surfaces` +
  `bind_guard` + the derived auth policy work end to end, verified on a real boot: bound to the
  tailnet address, `401` without a token.
- **The phone already runs a zero-dependency client** (`farm-client`: `farm-hello`, `farm-ask`,
  `farm-update`, `farm-announce`).
- **Activity already converges** — surfaces subscribe to what the runtime is doing rather than each
  polling their own way.

## Slice 1 — A second `OperatorChannel` adapter, over the surface that already exists

**Why first.** It is the cheapest proof that the wizard substrate is genuinely surface-neutral, and
it covers most of *"preciso estar acompanhando daqui?"* without building notifications or a systray.
The sidecar is already exposed on the tailnet behind a device token; the phone is about to hold one.
Point a browser at it and **the phone becomes a second screen for the node's prompts** — no new
protocol, no enrolment request, no mesh channel.

**Leverages:** the surface-neutral contract, its conformance suite, the declared surface, the device
credential.

**Unlocks:** answering any wizard from anywhere the tailnet reaches. Every prompt written from here
on works there for free.

**Measure before scoping:** `apps/refarm/src/commands/web-serve.ts` exists, but whether it can carry
the channel is **unverified** — that measurement is the first task of this slice, not an assumption
inside it.

**Watch for:** a web channel must not become a second implementation of prompt semantics. It renders
and returns; the contract stays the authority. If it starts making decisions the stdio channel does
not, the seam has leaked.

## Slice 2 — Delivery: being told a prompt is waiting

A second screen you have to remember to look at is a poll with extra steps. Delivery is the half
that makes slice 1 real.

**Leverages:** `channel-policy-v1`, `operator-state`, `runtime-operator`, and the activity
convergence — the runtime already announces; this subscribes and forwards.

**Start with one adapter, not a framework.** Telegram is the cheapest honest first: a bot token, no
infrastructure, and the operator already wants refarm to hold that account association. Matrix is
the natural second and validates the delivery seam the way a second source validated the identity
registry.

**Unlocks:** the boot-time offer the operator asked for weeks ago — *"o PC ligou, tem internet,
conecto a VPN?"* answerable from the phone — because by then there is both a way to ask and a way to
answer.

## Slice 3 — The two registries, then enrolment initiated from either side

Only now, and in this order: the registries first, the feature second. Building the feature first
would hardcode tailnet and SAS exactly as the first two drafts of the enrolment design did.

**Leverages:** the identity-source registry as the template; slice 2's delivery as one verification
method for free.

**Unlocks:** [symmetric initiation](2026-07-30-phone-initiated-enrolment-design.md) — either side
starts, the authoritative side confirms — and a credential that never crosses in plaintext.

**This is where `farm-update` finally matters**, because it is the first slice that puts new code on
the phone.

## Slice 4 — Systray

Last, deliberately. Slice 2 already solves *reach me*; a tray solves *reach me without a phone*,
which is comfort rather than capability. It is also the only slice with a hard host dependency, so
it is the one most likely to teach us something we did not want to learn about portability.

Taken after slice 1, it is another `OperatorChannel` adapter and inherits everything.

## The rule this path is really following

Each slice ships something the operator can use the day it lands, and each is a **second consumer**
of something already built rather than a first consumer of something new. A second consumer is what
proves an abstraction; a first consumer is what invents one. This repo has enough abstractions with
exactly one consumer — the path spends them instead.
