# The pending prompt — one shape, answered from wherever the operator is

Date: 2026-07-30
Status: Designed, not implemented
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — interfaces, devices and nodes
First slice of: [`2026-07-30-multi-surface-operator-path.md`](2026-07-30-multi-surface-operator-path.md)

## What forced this

The operator built `intention prepare` with a portable token so their phone could arm an attention
window. That is the right instinct solved by hand, for one wizard. Every wizard written after it
would need its own portable handoff — cost O(wizards).

`OperatorChannel` is already surface-neutral (`stdio`, `scripted`, `auto`, with a conformance suite
that fails a channel which does not cancel). A second real adapter makes **every wizard already
written, and every wizard not yet written, answerable from another device** — cost O(1).

## What the measurement changed

The assumed second surface was a browser. Measured: `refarm web serve` is a static file server plus
a `/sync` WebSocket proxy, with no prompt protocol, and there is no dashboard app in `apps/`
(`dev`, `farmhand`, `me`, `refarm`, `site`).

But a browser was never the requirement — it was an assumption. The phone already has the vendored
prompt block (`vendor/prompt-contract-v1.mjs`), a device credential, and authenticated reach to the
sidecar. It has a terminal, and that terminal works.

So the slice is not "a web UI". It is **the shape of a pending prompt on the wire**, plus an adapter
and a kit command. The browser stays possible later as the *third* consumer of the same shape — where
it proves the abstraction instead of inventing it.

## P1 — A pending prompt's lifetime is its asker's lifetime

The node holds pending prompts in memory and publishes them; nothing is persisted. If the daemon or
the asking process dies, its pending prompts die with it — which is correct, because there is no
longer anyone waiting for the answer. Persisting them would create the worst artifact available: a
question whose asker is gone, answerable, and answering nothing.

This also means no migration, no garbage collection, and no stale-answer problem. It is the
simplification that makes the first slice small enough to be right.

## P2 — Local and remote are peers; the first answer wins

The stdio channel does not become secondary. A prompt is offered **both** at the terminal that asked
and to any attending device, and whichever answers first settles it. The other side is told it was
answered elsewhere, and by which device — silence would leave a prompt visibly hanging at a terminal
someone is looking at.

This is what makes the feature honest rather than clever: sitting at the desk stays the fastest path,
and the phone is what you reach for when you are not at the desk.

## P3 — Who may answer is exactly who is enrolled

An enrolled device is the operator's device — that is what enrolment means. So any enrolled device
may answer any pending prompt, and the answer records **which** device settled it.

No finer-grained permission in this slice. Introducing one would require a model of *which* device
may answer *what*, and there is no second person here to need it. If a collective workspace ever
brings one, that model arrives with it rather than being guessed at now.

## P4 — A secret prompt is answerable remotely, and says so

The block already has a secret prompt that never echoes. Answered from another device, the secret
crosses the wire — authenticated per-device and inside the tailnet's WireGuard, but crossing
nonetheless.

That is acceptable and must be **stated in the prompt**, not assumed: the attending device shows that
this answer will travel. An operator who would rather walk to the desk deserves to know before
typing, not after. Never log the value, on either side — that constraint is already load-bearing in
the block.

## P5 — Waiting must be interruptible, and giving up must be a real outcome

The asking process blocks. Three ways it can end, all of which the asker must handle:

- answered locally;
- answered remotely (P2);
- **abandoned** — the operator cancels, or the asker's own deadline passes.

D13 says an attempt needing a human must first acquire the human, and that unacknowledged requests
park indefinitely. That is right for a *request*. It is wrong for a *blocked CLI*: a command that
waits forever with no way out is a command that gets killed with `Ctrl-C` and leaves half-applied
state. So a pending prompt carries the asker's deadline, and expiry is an outcome the asker handles
explicitly — not a hang.

## P6 — The wire shape is the reusable part, so it is what gets designed

Three consumers will read it: the stdio adapter, the attending kit command, and later a browser. It
carries what a prompt *is* — kind, question, options, constraints, whether the answer travels (P4) —
plus who asked, when, and the deadline. It does not carry rendering. A surface renders; the shape
does not decide how.

Getting this wrong is the expensive mistake in the slice, which is why it is designed before an
adapter exists rather than extracted from one afterwards.

## First slice

The shape, a remote `OperatorChannel` adapter on the node, and a kit command that lists pending
prompts and answers them — reusing the vendored block for rendering, so the phone's prompt looks and
cancels exactly like the terminal's.

The conformance suite gains the remote channel as a subject: a channel that cannot be answered from
elsewhere is not a channel this repo ships twice.
