# Declared delivery — being reached, on whatever you actually carry

Date: 2026-07-31
Status: Designed, not implemented
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — interfaces, devices and nodes
Pairs with: [`2026-07-30-pending-prompt-wire-design.md`](2026-07-30-pending-prompt-wire-design.md)

## What forced this

The pending-prompt slice makes a wizard answerable from another device. The operator caught what
that leaves out:

> *"eu teria que estar com o terminal aberto no termux? como se daria? … precisamos avaliar como
> construir o que na ponta precisa ser prático."*

They are right, and the multi-surface path document had already said it: *"a second screen you have
to remember to look at is a poll with extra steps."* Answering from elsewhere and **being told there
is something to answer** are two problems. Shipping the first without the second produces a feature
that only works when you were already looking.

Their instruction for how to build it: *"deixar tudo sobre a questão de declarar para poder ter, e
quem quiser usa como sdk o dx que a gente alcançar."*

## The sovereignty cost that is not obvious

Worth stating plainly, because the most app-like option is the least sovereign:

| adapter | third party | interactive | needs |
| :-- | :-- | :-- | :-- |
| `termux-notification` | **none** — fully local | yes, action buttons run a command | Termux:API app |
| Telegram / Matrix | one the operator already wants | yes | bot + token |
| PWA + Web Push | **mandatory** — FCM sees timing and target | yes | service worker, VAPID, a web surface that does not exist |
| self-hosted ntfy | low | yes | one more process to supervise |

Browser push on Android routes through the vendor's service. That is not a reason to refuse it; it
is a reason the operator should choose it knowingly rather than discover it later.

## D1 — Delivery is declared, never detected

`termux-notification` being *installed* does not mean the operator wants refarm sending them
notifications. Silence is closed here exactly as it is for `surfaces`: an undeclared adapter does not
exist, and refarm does not go looking for one.

The declaration is where the operator's consent to be interrupted lives. Detection then decides only
*how* to satisfy it — the same rule that settled the enrolment discovery question.

## D2 — The registry is the deliverable; the first adapter is not the mechanism

The journey is several adapters, so the seam ships with the first one. `identity-sources.ts` is the
proven precedent in this repo: a new source is one file plus one registry line, and the canonical
flow never learns it exists.

`termux-notification` earns first place by being fully local, genuinely interactive, and needing no
infrastructure — it proves the seam cheaply. It is not the answer; it is the first entry.

## D3 — An adapter may not promise a capability it does not have

This is the decision that costs the most if it is wrong.

Delivery adapters are **not interchangeable**. Some can carry a decision back — a Termux notification
with action buttons, a Telegram inline keyboard. Some can only announce: an email, a webhook to a
log, a desktop toast with no actions.

A wizard that needs an *answer* cannot be served by an announce-only adapter. If the catalog cannot
express that difference, refarm will eventually deliver "approve the VPN?" to a channel that can only
say it out loud, and wait forever for a reply that has nowhere to come from.

So an adapter declares what it can do — **announce** or **answer** — and refarm refuses to route a
prompt needing a decision to an announce-only adapter. This is
[S3](2026-07-29-declared-surfaces-design.md) in a new domain: *a thing may not declare a capability
it cannot enforce*, and it is the fourth time that rule has been the right answer.

An announce-only adapter is still useful — "there is a question waiting, go look" is real
information. It simply must be labelled as what it is.

## D4 — A delivery that failed is not a delivery that was not needed

If refarm could not reach the operator, that must be discoverable. A notification adapter that fails
silently produces the worst outcome available: a prompt waiting, an operator who was never told, and
nothing anywhere saying so.

This is the same distinction the codebase has now hit seven times — `down` vs `unknown`, no-peers vs
could-not-ask, refused vs absent. Delivery has three outcomes, not two: **delivered**, **refused by
the transport**, and **could not attempt**. The pending prompt carries which one happened, so an
operator who finds a question hours later can see whether it ever reached them.

## D5 — SDK DX: the common case is one line

*"quem quiser usa como sdk o dx que a gente alcançar."* The measure of success is that a wizard author
writes nothing about delivery. They ask a question through `OperatorChannel`; declared adapters carry
it. Delivery appears in their code exactly never.

An adapter *author* writes one file and one registry line. Anything more elaborate than that has
failed the brief, and the systemd/s6 lesson recorded in the connections design applies here too:
converge the vocabulary, do not build a configuration language.

## First slice

The declared `delivery` catalog with announce/answer capability, the registry, `termux-notification`
as its first entry, and the three-outcome result from D4 recorded on the pending prompt.

## Not in this slice

Telegram and the PWA. Both are named and both are wanted; each arrives as a second and third consumer
that proves the seam rather than shaping it. The PWA additionally needs a web surface that does not
exist yet, so it is not merely a matter of writing an adapter.
