# Declared delivery — being reached, on whatever you actually carry

Date: 2026-07-31
Status: First slice implemented (2026-07-30) — see "Implementation record" below
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

## D6 — Adapters split by *where they run*, and that decides the plugin question

The operator asked whether this belongs in an existing block, a new one, or a plugin. It has two
answers, and the split is not arbitrary — it is about which machine the notification appears on.

- **Node-side (push outward)** — Telegram, Matrix, Web Push, ntfy. They run on the node and need
  `NetworkOutbound`, which `packages/tractor/src/host/permission.rs` already has, alongside
  `ShellSpawn`, `FsRead`, `FsWrite` and `ConnectionUse`. These are **natural plugins**: refarm's core
  has no business shipping a Telegram client, and the plugin system already provides declared
  permissions, SHA-256 integrity through the Barn, and a lifecycle. The extension point exists and
  sits idle.
- **Device-side (raise locally)** — `termux-notification`. It must run on the phone, and the phone
  runs the zero-dependency kit, **not a WASM plugin host**. It cannot be a plugin. It is a kit
  capability, by physics rather than by preference — recorded here so nobody later "unifies" the two
  and breaks one.

## D7 — The cost I under-weighed, and the order it changes

The first version of this document recommended `termux-notification` first, for being fully local and
needing no infrastructure. That comparison omitted its real cost.

For a Termux notification to reach the operator **without a terminal open**, something must run in the
background on the phone, polling. Android kills background processes deliberately; wake-locks and the
job scheduler exist to fight that, and fighting it is the hard part of mobile, not an incidental. So
the sovereign option is not the cheap option — it is the one that requires winning an argument with
the device's operating system.

Meanwhile Telegram's app has already solved doze, battery and background delivery, maintained by
people whose job that is. Borrowing it is **the same move as borrowing systemd** in
[`2026-07-30-declared-processes-design.md`](2026-07-30-declared-processes-design.md): keep the
declaration, lend out the act.

Neither is free. Termux costs a technical fight that may be lost on the endpoint; Telegram costs
metadata at a third party. Presenting the first as free was the error.

**Order: Telegram as a plugin, then Termux in the kit.** The second is not optional politeness — it is
what proves the registry survives a device-side adapter, which is a genuinely different shape from a
node-side one. A registry validated by two adapters of the same shape has not been validated.

## D8 — Attended and unattended are different jobs, and the operator already declares which

D7 called Termux "expensive". The operator corrected it, and the correction is the better design:

> *"acredito que o termux ainda possa servir caso estejamos falando de um operador que sabe que
> precisa ficar no aplicativo durante a operação para não correr o risco."*

The background-poller cost applies **only to unattended delivery**. An operator who knows an
operation is running and deliberately stays in the app pays none of it — and in that case Termux is
the *best* option available, because it is the only fully sovereign one.

Two jobs, neither better than the other:

- **attended** — "I am bringing the VPN up now and watching." A local notification suffices, and no
  third party sees anything.
- **unattended** — "the machine woke at 3am and wants to know." Needs a channel that survives doze.

**And refarm already knows which applies**, because the operator declares it: `refarm intention arm`
is precisely *"I am attending, for this window"*. So the attention window is not only a gate for the
VPN — it is the fact that routes delivery. Armed ⇒ the device-side adapter is enough. Not armed ⇒
only an adapter that survives the phone being in a pocket will do.

This is the uniformisation, and it is why the kit keeps growing rather than being a lesser path: the
kit is the device-side surface, and the device-side surface is the *correct* one for attended
operation — which is how the operator works today, phone in hand.

It also means an adapter declares one more thing beside announce/answer: whether it delivers when
nobody is attending. An adapter that only works while the operator is looking is honest and useful;
one that claims otherwise and fails silently is D4's worst case.

## First slice

The declared `delivery` catalog with announce/answer capability (D3), the attended/unattended
property (D8), the registry, the three-outcome result (D4), and **Telegram as the first adapter,
shipped as a plugin** with `network:outbound`.

## Second slice

`termux-notification` in the kit, with the background-poller question answered honestly rather than
assumed — including what happens when Android stops the poller, which D4's "could not attempt" exists
to make visible.

## D9 — The web surface joins the first slice, because reach and interaction are halves

This document first deferred the web surface for needing something that does not exist. Measuring
again, that was wrong: `refarm web serve` already serves static files, `web` is already a declarable
surface, and `KNOWN_SURFACES` already admits it. What is missing is **a page**, not infrastructure.

The operator's reason for pulling it forward is sound — *"ficar sem web interface por muito tempo não
é interessante para a gente que precisa ganhar em muitas frentes"* — and so is the technical shape:
the smallest useful page is the pending-prompt list, one screen with no framework, consuming the same
wire shape the kit consumes. It is the **third consumer** that
[P6](2026-07-30-pending-prompt-wire-design.md) named as the test of whether the abstraction is real.

Telegram and the page are not competitors but complements: **Telegram is reach** — it finds the
operator in a pocket and survives doze — and **the page is the interaction surface** for anything
richer than a yes/no. A notification carrying a link to the page is the shape real systems settled on.

### The open question the page forces: where a browser keeps the credential

`web` is declared `gate: "none"` so cold bootstrap can work. The page being public is harmless — it is
HTML and JS. Its **calls** to the sidecar are not: they need a device credential, so a browser has to
hold a secret.

`localStorage` is the pragmatic answer and its cost is real: a secret readable by any script on that
origin. The good long-term answer is [E3](2026-07-30-phone-initiated-enrolment-design.md) — the
browser proves it is the operator's device through the emoji comparison and receives a scoped
credential, with nothing pasted. That is the SAS slice, not this one.

This is a decision for the operator, not a default to pick quietly: paste once and accept
browser-storage exposure, or stay on Telegram until E3 lands.

## Revised order

1. the pending-prompt wire shape;
2. **Telegram as a plugin *and* the web page** — reach and interaction together;
3. `termux-notification` in the kit — the attended, fully sovereign mode (D8).

## Not in this slice

Web Push. The page and push are separable: a page you open is useful immediately, while push drags in
FCM, VAPID and a service worker. Shipping the page first keeps that cost where it belongs — with the
feature that needs it, not with the surface.

---

# Implementation record — first slice, 2026-07-30

Status: **implemented** (catalog, capability vocabulary, attendance routing, three outcomes,
registry, Telegram adapter). The web page (D9) is **not** in this landing.

## Deviation from D6: Telegram ships as a package, not as a WASM plugin

D6 says node-side adapters are natural plugins, and for a **third party** that stays true — the
plugin system's declared permissions, SHA-256 integrity through the Barn, and lifecycle are exactly
what an untrusted adapter should have to pass through.

It is **not** what shipped here. A WASM plugin means Rust plus WIT plus Barn integrity, and the
immediate goal was reaching the operator at all. So:

- the **catalog and registry live in the core** (`apps/refarm/src/commands/delivery.ts`,
  `delivery-adapters.ts`);
- **Telegram ships as `@refarm.dev/delivery-telegram`**, a separate package outside the core app,
  consumed through the declared catalog.

This keeps the concern D6 actually had — *refarm's core has no business shipping a Telegram client*
— without paying the WASM cost now. The core imports one symbol,
`telegramDeliveryAdapterFactory`; it never learns that a chat id, an inline keyboard or `getUpdates`
exist. The adapter package imports `@refarm.dev/delivery-contract-v1` and nothing else, and has no
idea refarm's core exists.

What is genuinely deferred, and should not be forgotten: a **third-party** adapter installed by an
operator still has no integrity check and no declared permission boundary. A package in this
monorepo is trusted because it is in this monorepo. The plugin path is the answer for adapters that
are not, and D6's reasoning survives intact for that case.

## The contract is a block, because an adapter must not import the core

D2 asks for "one file plus one registry line". That is only achievable if the adapter can import the
vocabulary from somewhere neutral — a package cannot depend on `apps/refarm`. So the seam is
`@refarm.dev/delivery-contract-v1`, a zero-dependency block on the `prompt-contract-v1` /
`operation-consent-v1` model, carrying the capability vocabulary, the catalog parser, the routing
rules and the three outcomes. The registry itself is core, as scoped.

## A rule D3 was missing, found by writing the first adapter

A decision with **no enumerable choices** degrades to `announce`. A notification channel carries a
choice — an action button, an inline keyboard — not a text field; collecting free text needs a
conversation, which is a different capability from being reached. Left unstated, an answer-capable
channel would have accepted a `text` prompt it could never settle: the D3 failure, one level down.
Termux action buttons have the same shape, so this is vocabulary, not a Telegram limit leaking in.

## Where the operator's bot token goes

**Never in `.refarm/config.json`.** The catalog parser refuses `token`, `botToken`, `apiKey`,
`secret`, `password` and friends outright, and says so. A declaration NAMES a source; resolution
happens at use, following `REFARM_AUTH_POLICY`, which carries a path and never contents.

Exactly one of:

- `"tokenFile": ".refarm/delivery/telegram.token"` — a path, relative to the sovereign root or
  absolute. **Recommended**: file permissions are a real boundary, and the value never enters the
  process environment or any child process.
- `"tokenEnv": "REFARM_TELEGRAM_BOT_TOKEN"` — the NAME of an environment variable.

The declaration an operator writes to enable Telegram, in full:

```json
{
  "delivery": {
    "telegram": {
      "capability": "answer",
      "unattended": true,
      "chatId": "123456789",
      "tokenFile": ".refarm/delivery/telegram.token"
    }
  }
}
```

`chatId` is an identifier, not a secret, so it belongs in the declaration. `capability` and
`unattended` are both **required**: refarm will not guess whether a channel can carry a decision, nor
whether it reaches the operator when nobody is attending.

## The Rust side does not need to know

Checked before declaring anything, because `surfaces_decl.rs` is fail-shut and
`packages/tractor/**` is protected. The result: **no Rust change, and none needed.**

`refarm_config_json_from` parses `.refarm/config.json` into an untyped `serde_json::Value`, and every
catalog reads its own key by name — `cfg.get("surfaces")`, `cfg.get("connections")`,
`cfg.get("spawnEnv")`, `cfg.get("trusted_plugins")`, `cfg.get("approvedPermissions")`. There is no
`deny_unknown_fields` and no top-level key allowlist anywhere in the crate. The fail-shut refusal in
`surfaces_decl.rs` rejects an unknown **surface name inside** the `surfaces` block, which is a
different thing from an unknown top-level key.

The proof by precedent is already in production: `workspaces` has been a top-level key in the live
config for some time and Rust reads it nowhere. Verified empirically too — parsing the real config
with and without a `delivery` block yields a byte-identical `surfaces` catalog.

## Known debts, named rather than hidden

- **Attention is read in three places.** `intention.ts` writes the state file,
  `base-surface-status.ts` reads it, and `delivery.ts` now reads it too. Converging them into one
  reader is real work that would touch commands this slice had no business changing.
- **Proactive rate limiting is not implemented.** The operator already owns a researched,
  platform-agnostic limiter in `@aretw0/dgk-channels` (vault-seed), written explicitly to be shared.
  Its Telegram figures and its reasoning are used here rather than re-derived, and its `throttle()`
  is deliberately **not** reimplemented. Converging it properly — moving it into refarm as a shared
  block, with vault-seed then consuming refarm — is larger than this slice and is the right shape.
- **No third-party integrity boundary**, per the D6 deviation above.
- **Nothing mounts delivery in production yet.** The seam is complete and tested; like the
  pending-prompt hub it hooks, no long-running host constructs it. That wiring is the next step, and
  it is one call: `attachDeliveryToHub`.
