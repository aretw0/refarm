# Declared processes — refarm owns the declaration, the host may own the act

Date: 2026-07-30
Status: Designed, not implemented
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — substrate
Triggered by: *"P6 when refarm supervises a process it owns"* —
[`2026-07-29-process-administration-layer-design.md`](2026-07-29-process-administration-layer-design.md)

## What forced this

`refarm web serve` — the mesh distribution server the operator's phone bootstraps from — is running
in a `nohup`'d background shell. Nothing supervises it, nothing restarts it, and `refarm runtime
status` does not know it exists. If it dies, cold bootstrap and `farm-update` stop working and
nobody is told.

The 07-29 design listed P6 as out of scope with an explicit trigger: *when refarm supervises a
process it owns*. That trigger has fired.

The operator added the constraint that shapes this document:

> *"se puder trazer quem vai supervisionar caso possamos terceirizar o ato sem precisar acoplar ao
> tractor, mas se for necessário ele assume mesmo"*

## W1 — The declaration is refarm's; the supervision act may be borrowed

`connections` and `surfaces` established the split: the operator declares intent as data, the runtime
interprets it. `processes` is the third catalog under the same doctrine — command, liveness probe,
restart policy, all declared.

What is *new* here is that the **act** need not be refarm's. Every host already has a supervisor:
`systemd --user` on most Linux (measured running on the operator's node, with existing user units),
`launchd` on macOS, runit under `termux-services` on Android. Reimplementing supervision inside
tractor when the host ships a battle-tested one would be the reinvention this repo keeps refusing.

So: **refarm resolves a supervision backend** to satisfy a declared intent. That is detection used
correctly — it decides *how* to satisfy what the operator declared, never *what* they wanted.

## W2 — Borrowing a supervisor means changing the operator's machine, so it goes through consent

A systemd backend writes a unit file into `~/.config/systemd/user/`. That is a durable change to the
operator's computer, made on their behalf — precisely what
[`2026-07-30-operation-consent-and-record-design.md`](2026-07-30-operation-consent-and-record-design.md)
covers. `processes` becomes the **third consumer** of `@refarm.dev/operation-consent-v1`, and the
first that genuinely needs the *prompt* rather than only the record: the operator has not typed this
change themselves, something proposed it for them.

Everything R3 requires applies: the exact unit file shown before the decision, the record carrying
before/after, and an undo that actually removes what was installed.

## W3 — The request must state the limitation, not just the benefit

Measured on the operator's node: `Linger=no`. A `systemd --user` unit **stops when they log out**
unless lingering is enabled, and enabling it (`loginctl enable-linger`) is a second change to their
machine.

A request that says "I will keep this running" while omitting that it dies at logout has told a
useful-sounding untruth. The proposal must state the lifetime it actually delivers, and offer
lingering as a **separate, separately-authorised** operation — never bundled, because bundling is how
a small yes becomes a large one.

This is [R2](2026-07-30-operation-consent-and-record-design.md) with teeth: the operator authorises a
specific change, having been shown enough to judge it.

## W4 — A service is an end; a connection is a means

`connections` already does most of the mechanics — declared command, spawn, readiness probe, shared
registry, lifecycle. The temptation is to declare a long-running server "a connection that never
ends".

Refuse it. A connection is a **means**: it is opened so something else can happen, several
interested parties may share one, and it carries claim/release semantics that decide when it may
close. A service is an **end**: it exists to answer, nobody "claims" it, and release means nothing.
Folding the second into the first inherits a lifetime model that does not apply — which is how
process supervisors historically grew into things nobody can explain.

Share the mechanics where they genuinely coincide (spawn, probe, the derived environment of P10).
Do not share the vocabulary.

## W5 — Tractor is the fallback, and the fallback must exist

Not every host has a borrowable supervisor. Termux has no systemd, and the phone is a first-class
target here.

So tractor supervising a process directly stays in the design as the fallback — but it is the
fallback, taken when no host supervisor is available, not the default. `packages/tractor/src/respawn.rs`
already holds supervision *policy* (what to restart, an anti-hot-loop cooldown) for WASM plugins; its
shape is the precedent, its target is not.

## First slice

`refarm web serve` under a systemd user unit on the operator's node, declared in `processes`,
proposed through the consent block with its lifetime stated honestly, and recorded with a working
undo. This slice touches **no protected surface**: the node has systemd, so the act is borrowed and
tractor is not involved.

W5's fallback lands when a supervised process is needed on a host without a supervisor — the phone,
most likely, and that is the moment tractor takes it on.
