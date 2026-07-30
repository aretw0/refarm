# Phone-initiated enrolment, and where emoji verification actually belongs

Date: 2026-07-30
Status: Designed, blocked on the mesh channel
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — devices and nodes

## The two questions

The operator asked whether their phone could start its own enrolment, and whether a Matrix-style
random emoji list would be the right verification — or whether that belongs to a later, between-people
scenario.

They are one question. The second is the mechanism the first needs, and neither is buildable until a
bidirectional channel to the phone exists.

## E1 — A device may request enrolment; it may never complete one

Enrolment mints a credential, which is an act of **authorisation**. An unenrolled device that
enrols itself has authorised itself — the definition of privilege escalation. So the split is not a
matter of taste:

- the phone **requests**;
- the operator **approves**, on a surface that already holds authority.

This is [D13](2026-07-28-declared-connections-shared-sessions-design.md) applied to identity rather
than to connections: an attempt that needs a human must first acquire the human. It is also the
device-join shape Tailscale itself uses, so the operator already has the mental model.

## E2 — The first enrolment cannot come from the phone, and no design changes that

There is a bootstrap knot: the phone cannot reach the farm without a token, and the token is what
enrolment produces. Nothing resolves this by decree.

So the **first** credential is minted where authority already lives — the node the operator is
sitting at. From the second device onward, a phone that already holds a credential can carry a
request for the next one. Documenting the knot is better than pretending a flow exists that closes it.

## E3 — Emoji SAS is the right primitive, and it is worth nothing in today's flow

Matrix's emoji verification is **SAS** — a Short Authentication String derived from an established
key exchange. Its single purpose is to defeat a **man-in-the-middle on that exchange**: both sides
derive the same short string from the shared secret, a human compares them out of band, and a
attacker in the middle makes the strings differ.

Applied to enrolment as it works today: **no value.** The operator types a label on their node, the
node mints a token, the operator carries it to the phone. There is no key exchange to attack — the
channel is the human, physically. Comparing emoji would compare a string with itself.

Applied to E1: **exactly the missing piece.** When the phone requests enrolment over the network,
the node must establish that the request came from the device in the operator's hand rather than
from someone else on the tailnet. Emoji comparison answers that, and answers it *better* than
carrying a token, because nothing secret crosses the channel.

It is also not a between-people mechanism. It is between **devices of one operator** — precisely
Matrix's cross-signing case, verifying your own second device.

Two constraints for whoever builds it:

- **Do not invent the emoji set.** Matrix specifies 64 emoji with names and translations because
  visual ambiguity breaks the comparison. A home-grown set is a footgun wearing a costume.
- **The security parameter is bits compared, not the presence of emoji.** Matrix compares 6 of 64,
  about 36 bits. Trimming the count for a prettier screen weakens it for real.

## Order, and the blocker

E1 and E3 both require a **bidirectional channel** between node and phone — the `OperatorChannel`
over the mesh
([design](2026-07-29-operator-channel-over-the-mesh-design.md)). Without it there is no request to
carry and no second screen to compare against.

So: mesh channel first, then E1 with E3 as its confirmation step. Building E3 before the channel
would produce a verification ritual with nothing to verify.
