# Phone-initiated enrolment, and where emoji verification actually belongs

Date: 2026-07-30
Status: Designed, not implemented
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — devices and nodes

> **Revised the same day it was written.** The first version claimed the phone
> *requests* and the node *approves*, that a first enrolment could never come from the
> phone "regardless of design", and that all of this was blocked on the mesh
> `OperatorChannel`. The operator pushed back — *"gosto de poder começar o processo de
> enroll dos dois lados, mesmo sabendo que o outro lado tem que confirmar"* — and two of
> those three claims turned out to be overstatements. They are corrected below rather
> than quietly rewritten, because the reasoning that produced them is the interesting part.

## The two questions

The operator asked whether their phone could start its own enrolment, and whether a Matrix-style
random emoji list would be the right verification — or whether that belongs to a later,
between-people scenario.

They are one question. The second is the mechanism the first needs.

## E1 — Initiation is symmetric; authorisation is not

Enrolment mints a credential, which is an act of **authorisation**. A device that enrols itself has
authorised itself — the definition of privilege escalation. That constraint is real, but it binds
only the *completion*:

- **either side may initiate** — the node or the device;
- **only a side that already holds authority may confirm.**

The operator's phrasing is more precise than the first draft's "the phone requests, the node
approves", which quietly assumed the node is always the initiator. Symmetric initiation costs
nothing security-wise, because a pending request grants nothing until confirmed, and it matches how
an operator actually behaves: sometimes you are holding the phone, sometimes you are at the desk.

This is [D13](2026-07-28-declared-connections-shared-sessions-design.md) applied to identity rather
than to connections: an attempt that needs a human must first acquire the human.

## E2 — The bootstrap knot is real but smaller than first stated

**Corrected.** The first version said the phone cannot reach the farm without a token and therefore
the first credential can never originate there. The premise assumed every surface demands a farm
credential.

But `packages/tractor/src/sidecar/auth.rs` already records the layering: **the tailnet authenticates
the device to the network; the token authenticates it to the farm.** A request arriving over the
tailnet is not anonymous — it comes from a device the operator already admitted to their network.
That is a genuine first factor, and it is exactly the kind of thing the layering exists to let us
rely on.

So a narrowly-scoped surface is admissible: **reachable only over an admitted-device transport,
unauthenticated, and able to do exactly one thing — create a pending request that grants nothing.**
The knot shrinks to a set of conditions rather than an impossibility:

- reachable **only** over a transport the operator declared as carrying admitted devices — never
  loopback-only (useless) and never public;
- its sole effect is a pending request; no credential, no state a caller can read back;
- bounded — a queue depth and a rate limit, so a misbehaving peer cannot flood the operator;
- every pending request is confirmed out of band, with E3's comparison.

Without that last condition the surface becomes a social-engineering channel: a stream of "approve
me" prompts, one of which is not the operator's device. E3 is what makes the surface safe, not
decoration on top of it.

## E3 — Emoji SAS is worth nothing in today's flow and exactly right for this one

Matrix's emoji verification is **SAS** — a Short Authentication String derived from an established
key exchange. Its single purpose is to defeat a **man-in-the-middle on that exchange**: both sides
derive the same short string from the shared secret, a human compares them out of band, and an
attacker in the middle makes the strings differ.

Applied to enrolment as it works today: **no value.** The operator types a label on their node, the
node mints a token, the operator carries it to the phone. There is no key exchange to attack — the
channel is the human, physically. Comparing emoji would compare a string with itself.

Applied to E1/E2: **exactly the missing piece**, and it improves the flow on both axes at once.

The shape, over plain HTTP request/response:

1. the initiating device posts an ephemeral public key with its request;
2. the confirming side answers with its own;
3. both derive the same shared secret and display the same 6 emoji;
4. the operator compares the two screens and confirms on the authoritative side;
5. the credential comes back **encrypted to the requester's key**.

Step 5 is the part worth noticing: **the token never crosses in plaintext and the operator never
types or copies it.** That is better than today's flow on usability *and* on secrecy, which is rare
enough to call out.

It is also not a between-people mechanism. It is between **devices of one operator** — precisely
Matrix's cross-signing case, verifying your own second device.

Two constraints for whoever builds it:

- **Do not invent the emoji set.** Matrix specifies 64 emoji with names and translations because
  visual ambiguity breaks the comparison. A home-grown set is a footgun wearing a costume.
- **The security parameter is bits compared, not the presence of emoji.** Matrix compares 6 of 64,
  about 36 bits. Trimming the count for a prettier screen weakens it for real.

## E4 — Transport and verification are registries, not choices

**Added after the fact.** The first two versions of this document said "tailnet" wherever they meant
"a network whose peers the operator has already admitted", and "emoji SAS" wherever they meant "a way
for a human to confirm this is the right device". Both are implementations that got written down as
the concept — the same mistake C3 made with the `surfaces` declaration, three documents in a row now.

The operator named the cost: an overlay that is not Tailscale, or refarm's own mesh superseding it,
or a confirmation that arrives through Telegram or Matrix, would each have to be bolted on rather
than plugged in.

So both are **registries**:

- **Admitted-device transports.** What matters is the property, not the product: arriving over this
  transport already means the operator admitted this device to something. A tailnet has that
  property. Refarm's mesh can have it. A LAN with mTLS can have it. The pending-request surface asks
  the registry "is this request arriving over an admitted-device transport?", never "is this
  Tailscale?".
- **Verification methods.** Emoji SAS is one entry, and the strongest for two screens in one pair of
  hands. A confirmation delivered through an already-trusted account — Telegram, Matrix — is another
  entry with different properties, and the operator has said they want those anyway, since refarm
  tends to become the operational sink for credentials and accounts.

This is not speculative architecture. `apps/refarm/src/commands/identity-sources.ts` is already
exactly this shape, and it shipped today: a new discovery source is one file plus one registry line,
and the canonical flow does not learn that it exists. Give transports and verification methods the
same seam and the second one of each is cheap.

## E5 — Honest protocol citizenship, written once in the substrate

The operator is sceptical that we should worry much about a proliferation of bad citizens, and
right that the worry is not abstract morality — it is about our own stack not becoming a promoter,
including through our own footguns.

The practical form is a short list, and its value is entirely in *where* it lives. Written once in
the substrate, every adapter inherits it. Left to each adapter, it is forgotten once per adapter:

- a bounded queue and a rate limit on anything a remote peer can create;
- honest polling — backoff, not a tight loop, and a stated interval rather than as-fast-as-possible;
- a client that identifies itself, so the other side can attribute and throttle us;
- nothing readable back before confirmation, so a request cannot be used to probe;
- refusal that says why, since a silent drop teaches a caller to retry harder.

The last one is this codebase's own recurring lesson — "the answer is no" and "I could not ask" are
different — pointed outward at the peers we talk to instead of inward at ourselves.

## What this is actually blocked on

**Corrected.** The first version said the mesh `OperatorChannel` was the prerequisite. It is not.
The exchange above is request/response plus polling — the HTTP sidecar already carries it, and that
sidecar already binds to the tailnet under a declared surface.

The real prerequisites are smaller and all local to this feature: the pending-request surface with
its bounds (E2), the key exchange and emoji rendering on both sides (E3), and a confirmation step
in the CLI. The mesh channel would make the confirmation *nicer* — a push instead of a poll — but
it is an improvement, not a gate.

Recording it as blocked on the mesh channel would have parked a buildable feature behind an
unbuilt one. Worth remembering as a failure mode: a dependency that is merely *convenient* is easy
to write down as *required*.
