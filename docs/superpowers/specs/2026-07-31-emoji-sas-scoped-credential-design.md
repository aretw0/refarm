# Emoji SAS — a surface proves it is the operator's, and receives a credential it never typed

Date: 2026-07-31
Status: Designed, not implemented
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — devices and nodes
Implements: E3 of [`2026-07-30-phone-initiated-enrolment-design.md`](2026-07-30-phone-initiated-enrolment-design.md)

## What forced this

The web page needs to call the authenticated sidecar, so a browser must hold a credential. The
pragmatic option was paste-once into `localStorage`, whose cost is a secret readable by any script on
that origin. The operator chose the other path:

> *"esperamos e3"*

So E3 stops being a later refinement and becomes the thing that unblocks the web surface honestly.

## A correction before anything is built

Earlier in this work I twice stated Matrix compares **6 emoji from 64, about 36 bits**. That is wrong.
Matrix's emoji SAS compares **7 emoji from a set of 64 — 42 bits**. The number is a security
parameter, not a presentation detail, and a design built on the smaller figure would be weaker than
the reference it claims to follow.

The set itself is not ours to invent: Matrix specifies 64 emoji with names and translations precisely
because visual ambiguity breaks a human comparison. Use theirs.

## S1 — P-256 ECDH through WebCrypto, because it exists everywhere already

The repo already treats `crypto.subtle` as its runtime-agnostic primitive (`asset-resolver-contract-v1`
states the posture explicitly: `crypto.subtle` in the browser, Node's crypto on the server), and uses
it for digests today. No key exchange exists yet.

**P-256 ECDH** is available through WebCrypto in every current browser and in Node, with **zero
dependencies**. X25519 is the nicer curve and its WebCrypto support is still uneven across browsers —
choosing it would trade a real portability problem for a marginal aesthetic gain. If browser support
settles, the algorithm is one constant, not a redesign.

Zero dependencies is not incidental here: the same primitive has to work in the browser, on the node,
and in the zero-dependency kit.

## S2 — The comparison must bind the transcript, not just the secret

The subtle failure mode: deriving the emoji from the shared secret alone. Two parties can share a
secret and still disagree about *who they think they are talking to*.

So the short string is derived over the **transcript** — both public keys and a session identifier —
not merely the ECDH output. Concretely: HKDF over the shared secret, with the two public keys and the
session id bound into the info parameter, then the first 42 bits mapped to 7 emoji.

Getting this wrong produces a ritual that looks identical and authenticates nothing, which is worse
than no ritual: it manufactures confidence.

## S3 — What comes back is a scoped credential, not the device token

The point of E3 is not a nicer way to move the same secret. A browser receives a credential that is:

- **scoped** — it may answer prompts; it is not a full device credential;
- **expiring** — a browser session is not a device enrolment, and the difference should be visible in
  the credential's lifetime;
- **revocable individually** — `refarm auth revoke` already exists, and a browser session must appear
  there as its own entry rather than hiding behind the device that opened it.

Otherwise the browser simply holds the device token with extra steps, and the `localStorage` exposure
the operator rejected comes back unchanged.

## S4 — Confirmation happens on a surface that already holds authority

The operator compares the two emoji rows and confirms on the node's CLI, or on an already-enrolled
device. That is [E1](2026-07-30-phone-initiated-enrolment-design.md)'s rule unchanged: initiation is
symmetric, authorisation is not.

The confirming side shows what it is authorising — which surface, what scope, how long — before
asking. A confirmation prompt that shows only emoji has told the operator to compare pictures without
telling them what they are agreeing to.

## S5 — Failure is loud, and a mismatch is not a retry

If the rows differ, the exchange is **aborted**, not retried, and the abort is recorded. A mismatch is
the one signal this whole mechanism exists to produce; treating it as a transient error to try again
discards exactly the information that was worth having.

Rate-limit attempts per the citizenship rules in
[E5](2026-07-30-phone-initiated-enrolment-design.md), so a mismatched party cannot grind.

## First slice

The exchange (S1, S2), the browser side that generates a keypair and renders 7 emoji, the CLI
confirmation showing scope and lifetime (S4), and a scoped credential issued into the existing auth
policy so `auth list` and `auth revoke` already understand it (S3).

## Not in this slice

Phone-initiated *enrolment* (E1/E2's pending-request surface). This slice authenticates a **surface**
the operator is already sitting in front of; enrolling an absent device over a tailnet-only pending
queue is a different flow with different bounds, and it inherits this exchange rather than being it.
