# The operator channel over the mesh — the OS asks, the operator answers from their phone

Date: 2026-07-29
Status: Designed; first slice named, nothing built
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — machine empowerment / notifications

## What the operator actually asked for

Not a notification system. Read the request closely:

> *"se eu liguei o pc do zero é de se esperar que eu intencione via termux ou pwa esse pedido de vpn … quando esse pc liga e tem internet ele pode me confirmar justamente isso, que ligou e que eu posso seguir trabalhando, oferecendo conectar na vpn como sugestão"*

Three things, and only the first looks like a notification:

1. **Tell me the machine is up and reachable.**
2. **Offer the next step I configured** — connect the VPN — as a suggestion, not an automatic action.
3. **Let me answer from my phone**, and have the machine act on that answer.

A message with an offered action that expects an answer is not a notification. **It is a prompt
delivered remotely.** And refarm already has the contract for prompts.

## The unification

`@refarm.dev/prompt-contract-v1` defines:

```ts
export interface OperatorChannel {
  ask(prompt: ConfirmPrompt): Promise<boolean>;
  ask(prompt: SelectPrompt): Promise<string>;
  ask(prompt: TextPrompt): Promise<string>;
  ask(prompt: SecretPrompt): Promise<string>;
}
```

**Nothing in it assumes locality.** It is `ask(question) → promise of an answer`. A channel whose
transport is the operator's phone satisfies it exactly, and
`runOperatorChannelConformance(channel)` already exists to prove a new channel behaves like the
others.

So the thing to build is **a third channel**, not a new subsystem:

| channel | the human is | exists |
| --- | --- | --- |
| `createStdioOperatorChannel` | at the terminal | yes |
| `createAutoOperatorChannel` | absent — answers the default | yes |
| **the mesh channel** | on their phone | **this design** |

Everything else composes on it, with no new vocabulary:

- *"the machine is up — connect the VPN?"* → a `ConfirmPrompt` on the mesh channel.
- **D13's attention handshake** (a step that needs a human must first acquire the human) → the same
  channel. D13 is not a separate mechanism; it is this channel used before an establish.
- **The MFA rung** (user+password+MFA for SerproID) → `SecretPrompt` on the same channel.
- **`ovpn-serpro`, written today, already asks through this contract** — it would prompt on the
  operator's phone without changing a line of the adapter.

A notification with no answer is the degenerate case: a prompt that asks nothing. Building the
channel gives notifications for free; building notifications first would give a channel never.

## What is genuinely new

The contract is done. Four things are not.

### N1 — A prompt may take minutes, or never be answered

`createStdioOperatorChannel` resolves in seconds. A phone prompt may sit unanswered while the
operator sleeps. D13 settled the policy — **an unacknowledged request parks indefinitely, it never
expires** — so `ask` on this channel may never resolve. That is legal for the contract (it returns a
Promise) but constrains every caller:

- no lock may be held across an `ask` on this channel;
- a pending prompt must be **visible** — the operator must be able to see what is waiting for them
  and answer it later from a different surface;
- the caller must tolerate cancellation (`OperatorPromptCancelledError` already exists).

This is the constraint that makes the mesh channel different in kind, not just in transport, and it
is why it is named before implementation rather than discovered during it.

### N2 — Delivery: putting the prompt in front of the human

One prompt → visible on that device. Per-device adapters, one narrow contract:

- **Termux** — `termux-notification` (from `termux-api`), which supports action buttons, so a
  `ConfirmPrompt` can be answered from the notification itself.
- **PWA** — Web Push (needs VAPID keys and a service worker) or, far cheaper first, an open page
  consuming SSE.
- **Desktop** — `notify-send`.

Follow the pattern `prompt-contract-v1` already set: detection over declaration. A device announces
what it can deliver; nothing is configured by hand where it can be observed.

### N3 — Correlation and the answer path

A prompt needs an id so an answer maps back to the `ask` that is waiting. D9 already specified
`prompt_id` for exactly this, and the connection control plane already proved the shape: frames go
out, answers come back through the host's control plane. `stream:v1` carries the outbound half
today, with `sequence` as a resume cursor so a phone that was offline catches up.

### N4 — Reach: the machine must be addressable from the phone

The sidecar HTTP already exists and already has the opt-in per-device auth gate
(`packages/tractor/src/sidecar/auth.rs`). It binds loopback by default. Reaching it from the phone
is the slice-3 decision the operator already signed off on: **discover the tailnet IP and bind
exactly to it, fail-closed** — never falling back to a wider exposure — with `--host <ip>` validated
against the tailnet as the manual mode and a per-request peer filter only as a named escape hatch.

`auth.rs` already states the layering this depends on: *the tailnet authenticates the device to the
network; the token authenticates it to the farm.* They are not redundant.

## The boot announcement, and where it lands

*"quando esse pc liga e tem internet ele pode me confirmar que ligou"* needs something running
before anything is running. That is a bootstrap, and it belongs to the layer the operator asked
about in the same breath — **what is installed on this machine and how it stays current**.

Refarm has four documents on distribution (`DISTRIBUTION_STRATEGY.md`,
`distro-evolution-model.md`, `ECOSYSTEM_SUPPLY_MAP.md`, `REFARM_CLI_DISTRO.md`) and three blocks
(`barn` with SHA-256 integrity, `artifact-contract-v1`, `release-engine`), but none covers system
executables and boot-time units — `barn` governs plugins.

Two observations worth recording rather than solving now:

- **"How do I install this on my PATH" and "how do I get this onto my phone" are the same
  question.** Running `ovpn-serpro` under Termux needs the same artifact delivered to another
  device, which is exactly the `mesh-binary-distribution-vision` the operator already recorded. The
  second consumer for that layer is therefore close, and it is Termux.
- The boot announcement itself is small once the channel exists: a user-level unit that starts the
  runtime, waits for reachability, and asks one `ConfirmPrompt`. What it must NOT be is a bespoke
  script that knows about VPNs — the offer is a *declared* connection, so the announcement asks
  about whatever the operator declared, not about a hardcoded tunnel.

## First slice

**The mesh channel end to end, with one delivery adapter, proving one real prompt.**

In: the tailnet-bound sidecar exposure (N4, already signed off); a pending-prompt surface plus the
answer call (N3); the mesh `OperatorChannel` that passes `runOperatorChannelConformance` (N1); and
one delivery adapter — Termux first, because `termux-notification` carries action buttons, so a
`ConfirmPrompt` is answerable from the notification itself without a second surface.

The proof is concrete and already has its subject: `ovpn-serpro`'s existing
`ConfirmPrompt` — *"Conectar VPN Serpro? Isso vai disparar um push de aprovação no celular"* —
arriving on the operator's phone, answered there, and the connection establishing as a result.
Nothing in the adapter changes; only which channel it was handed.

Out, with triggers: the PWA delivery adapter (when a browser surface exists); Web Push proper (when
an open SSE page proves insufficient); the boot unit (when the channel works); the install/mesh
distribution layer (when Termux needs the binary, which is the trigger, not a hypothetical).

## Why this order

Building notifications first would produce a one-way pipe, and every later need — the boot offer,
D13's handshake, the MFA code — would each grow its own answer path. Building the channel first
means the notification is the degenerate case and the answer path exists once. The operator asked to
canonicalise what matters; this is the seam where canonicalising pays, because four separate futures
collapse into one contract that already ships and is already consumed.
