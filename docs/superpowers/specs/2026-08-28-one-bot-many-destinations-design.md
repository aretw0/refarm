# One credential, many destinations

**Status:** decided 2026-08-28. The probe half shipped in `12d56932` (ISS-174); the
workspace-destination half is specified here and not yet built.

## The question the operator asked

> "imagino um bot ou gateway por workspace? dois no mesmo faz sentido? (...) um bot para o nó e
> outros para cada um dos workspaces? ou um bot geral para nó e tudo o que os workspace tragam?
> suportar tudo da melhor forma cultivando com organicidade"

## The answer, and why

**One credential, many destinations.** The bot is the TRANSPORT; the chat is the DESTINATION. A
workspace that wants its own channel declares a destination, not a credential.

| topology | what it costs |
| --- | --- |
| one bot per workspace | N tokens to mint, store, rotate. The node's own questions — a runtime restart, a credential renewal — belong to no workspace, so it is always N+1. A new extension in a workspace must mint a credential before it can ask anything. |
| one bot, N destinations | one token. A workspace declares a chat id. Separation happens by CONVERSATION, which is how a person already uses the app. Reversible: changing a destination is an edit, minting a bot is not. |

MEASURED, and it is why the second row is possible at all: Telegram's Bot API addresses a chat
per call — `sendMessage` takes `chat_id`. One bot reaching several chats is the platform's own
model, not a workaround.

### The exception is IDENTITY, not organisation

Two bots make sense when the far side must see a different sender. A corporate workspace posting
into a company group needs a company-owned bot, not the operator's personal one — the boundary he
has drawn elsewhere as "empresa só via plugins".

So the design must ALLOW N without REQUIRING N. A workspace either references a node channel and
names its own destination, or declares its own channel when identity forces it. Organic growth
means starting with one and paying for a second only where the reason is real.

## Decisions

### D1 — a workspace names a destination, not a transport

A workspace declaration may carry a `delivery` block that REFERENCES a declared channel by name
and overrides only its destination:

    workspaces.rcdc5.delivery = { channel: "telegram", options: { chatId: "-100123…" } }

The credential, the adapter and the capability come from the node's channel. What the workspace
adds is where the message lands.

WHY A REFERENCE AND NOT A COPY: a copied declaration is a second place for the token source to
drift, and this repository has spent a week removing exactly that shape. The node's channel is
the single declaration; a workspace's block is a delta over it.

### D2 — a workspace MAY declare its own channel, and then it is a full one

When identity differs, the workspace declares a channel the same way the node does — adapter,
capability, unattended, token source. No new grammar. The cost of a second credential is paid
deliberately and visibly, in the same shape, rather than smuggled in as an option.

### D3 — routing resolves workspace-first, node-fallback

A question raised in a workspace context routes to that workspace's destination when one is
declared, and to the node's otherwise. A question with no workspace — the node's own — routes to
the node's channel and never to a workspace's.

WHY THE FALLBACK IS ONE-WAY: a node question landing in a work chat is a leak of context the
operator did not ask for. A workspace question landing in the node chat is a mild loss of tidiness.
The asymmetry is deliberate and follows the harm.

### D4 — the probe answers per destination, not per credential

`probe()` shipped answering "is this transport reachable, and as whom". With destinations, a
second question appears: can this bot actually reach THAT chat? For Telegram that is
`getChat(chat_id)`, which sends nothing.

NOT BUILT YET, and deliberately: today the node has one destination and a per-destination probe
would be a capability with no consumer — the shape this repository keeps finding and paying for.
It lands with the first second destination, not before.

### D5 — `delivery list` groups by scope

Once workspaces declare destinations, the list must say WHICH scope each row belongs to, or an
operator reading it cannot tell the node's channel from a workspace's. The three reachability
states stay as they are; the row gains a scope.

## What shipped already (ISS-174)

`DeliveryAdapter.probe?()`, optional so an adapter that cannot answer says so by absence. Telegram
implements it with `getMe`. `delivery list --probe` reports `unsupported` / `unprobed` /
`reachable` with an identity / `unreachable` with a reason, and reaches no network without the
flag. Proven on the operator's node: `{"state":"reachable","identity":"@refarm_hand_bot"}`.

## Out of scope

- Matrix and WhatsApp adapters. The contract now carries the question; a transport answers it when
  a transport exists.
- Per-workspace credentials as the DEFAULT. D2 allows them; nothing encourages them.
- Group management (adding the bot to a chat). That is an operator action on the platform, and
  refarm's part is to say whether it worked.
