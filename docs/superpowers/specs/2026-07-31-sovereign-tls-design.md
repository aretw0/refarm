# Sovereign TLS — the node can trust itself, and Tailscale is one way among others

Date: 2026-07-31
Status: Designed, not implemented
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — interfaces, devices and nodes
Blocks: the browser surface (`GET /attend`) and everything downstream of it

## What forced this

The browser surface shipped and cannot work: **`crypto.subtle` requires a secure context.** HTTPS,
or `http://localhost` — a tailnet hostname over plain HTTP is not one. So at
`http://serpro-1577853:4321/attend` the emoji SAS never runs, no credential is issued, and the page
is dead. No test caught it because no browser was ever opened.

Secure context has no workaround. Any design that routes the credential around it lands back where
[E3](2026-07-31-emoji-sas-scoped-credential-design.md) started, pasting secrets.

`tailscale cert` was the obvious fix and failed twice on the operator's machine — first needing root,
then `your Tailscale account does not support getting TLS certs`. Their answer set the direction:

> *"prefiro cultivar o jeito soberano e tailscale como extensão como foi até agora, canônico com
> tailscale complementando por eu ser usuário e não porque o refarm fica acoplado ao tailscale."*

## T1 — Canonical is a certificate the node issues itself; Tailscale is an extension

This is the fourth time the canonical/extended split has been the right shape here — after discovery
sources, admitted-device transports, and delivery adapters. Stated once more because it keeps being
correct:

- **Canonical**: refarm can create a local certificate authority and issue a certificate for its own
  surfaces. It depends on nothing outside the machine, works on any network, and is available to an
  operator who has never heard of Tailscale.
- **Extended**: an operator who *uses* Tailscale can have refarm ask `tailscale cert` instead, and
  get a publicly-trusted certificate with no CA to install on their devices.

refarm must not be coupled to Tailscale. It is one provider that a Tailscale user may prefer, not the
mechanism.

## T2 — Certificate provisioning is a registry

Same seam as everywhere else: a provider is one file plus one registry line. Local CA first because it
is the canonical one; `tailscale cert` second, which is what proves the registry rather than shaping
it. An operator with an existing certificate — from their own infrastructure, from anywhere — must be
able to declare that path and have refarm use it without a provider at all.

## T3 — The sovereign path is also the one that needs no privilege

Worth recording because it is not obvious and it settles an operational question:

`tailscale cert` requires **root**, or a standing `tailscale set --operator=$USER` grant. That grant
is not narrow — it lets anything running as the operator control the tailnet: bring it up, take it
down, change exposure. **Including refarm's own agent**, which today cannot.

A locally-issued certificate needs neither. So the sovereign path is *also* the one that avoids a
standing privilege grant, and the one whose renewal can be supervised by the
[`processes`](2026-07-30-declared-processes-design.md) catalog without a root-owned process.

The two costs, stated so the operator chooses knowingly:

| | who issues | device friction | external exposure |
| :-- | :-- | :-- | :-- |
| local CA | the operator | install the CA once per device | none |
| `tailscale cert` | Let's Encrypt via Tailscale | none | the hostname enters public Certificate Transparency logs, permanently |

## T4 — Trusting a CA is a change to a device, so it goes through consent

Installing a certificate authority on a phone is a **significant grant**: that CA can then vouch for
any name. It is exactly the class of change
[`2026-07-30-operation-consent-and-record-design.md`](2026-07-30-operation-consent-and-record-design.md)
exists for — refarm must say plainly what it is asking for, not present it as a setup step.

And the honest framing matters here more than usual: "install this certificate" reads as routine, and
it is not. The request must state what the CA can do, which devices are affected, and how to undo it.

## T5 — Changing the scheme breaks the devices already bootstrapped

The kit installed on the operator's phone has `http://serpro-1577853:4321` baked into `.farm-host`
and its manifest polling. Switching the surface to HTTPS without a path forward **breaks
`farm-update` on a device that is already working**.

So this slice owns that migration: either both schemes are served during a transition, or the kit
learns to follow a scheme change, or `dist publish` re-bakes and the operator re-runs the installer.
Whichever is chosen, it is not acceptable for an already-bootstrapped device to silently stop
updating — that is exactly the "delivered vs could-not-attempt" failure, in a new costume.

## First slice

The local CA provider, the declaration that names which provider a surface uses, the consent-carried
request to trust the CA on a device, and the migration in T5. `tailscale cert` follows as the second
provider, for an operator who wants it.
