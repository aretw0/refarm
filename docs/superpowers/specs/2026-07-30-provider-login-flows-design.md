# Provider login — one question, three surfaces

Date: 2026-07-30
Status: Designed, not implemented
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — idle quota / machine empowerment

## What was asked, and what it actually is

The operator asked for four things: GitHub Copilot as a model provider (as pi.dev does it), reuse of
the existing subscription-login experience, support for device-code login, and an official branded
callback screen like the one pi shows when a login completes.

Those are not four features. They are one question — **how does an operator prove identity to a
provider, on whatever surface they happen to be on** — with three answers depending on the surface,
and one second consumer that proves the abstraction is real.

## What already exists (measured, 2026-07-30)

Two of the four are further along than the request assumed, and one is further behind.

- **The callback screen exists.** `apps/refarm/src/credentials/oauth/oauth-page.ts` renders a dark,
  centred page with a title, heading and message. What it lacks is not a page — it is **identity**.
  And the place to plug that in already exists too: `apps/refarm/src/commands/brand.ts` reads
  `REFARM_BRAND_NAME` and is explicitly built for white-label deployments. The page does not consume
  it. So the gap is one seam, not a screen.
- **The OAuth machinery exists and is proven.** `credentials/oauth/` has PKCE, a callback server, a
  callback-wait loop, and two working providers (`openai-codex.ts`, `anthropic.ts`), each with tests
  beside it. As of today those flows also emit through the activity contract, so a login already
  lights up any subscribed surface.
- **Copilot is already classified, not unknown.** `docs/model-provider-strata.md` names
  `github-copilot` a subscription provider and documents the exact mechanism — GitHub device OAuth,
  exchange at `api.github.com/copilot_internal/v2/token`, then the endpoint the returned token
  advertises — and links pi's implementation. `GITHUB_COPILOT_ACCESS_TOKEN` already satisfies its
  credential check. `refarm ask` **blocks it honestly**: subscription routes without a runtime
  adapter are refused, and only `openai-codex` is in `RUNTIME_SUBSCRIPTION_MODEL_PROVIDERS`.
- **Device code: nothing.** No provider implements it, anywhere.

## D1 — Device code comes first, because it is the flow that needs no browser

The instinct is to add Copilot first, since that is the named goal. That order is wrong.

Every existing provider uses a browser redirect to a local callback server. That works on a laptop
and **cannot work on the operator's phone**: in Termux there is no browser to redirect back into a
loopback port. Device code is the flow designed for exactly that constraint — the device shows a
short code, the human authorises it on any other screen, and the device polls until it is granted.

And it is not a detour from Copilot: **GitHub's Copilot login is device OAuth anyway**, per the
strata doc. So the flow that unblocks the phone is the same flow Copilot requires. Building it first
means Copilot arrives as its second consumer rather than its motivation.

Implementation shape: a device-code flow beside the PKCE one in `credentials/oauth/`, sharing the
provider interface the two existing providers already satisfy, so `refarm sow` and the credential
resolution do not learn a new concept — only a second way to obtain the same credential.

## D2 — Copilot is the second consumer, and it has two halves

Already mapped, and worth restating so the halves are not conflated:

1. **TypeScript** — `apps/refarm/src/credentials/oauth/github-copilot.ts`, mirroring
   `openai-codex.ts`, using D1's device-code flow. Registered in `credentials/oauth/index.ts` and
   `credentials/model.ts`.
2. **Rust** — the runtime adapter in Tractor's `wasi_bridge`, plus adding the provider to
   `RUNTIME_SUBSCRIPTION_MODEL_PROVIDERS`, which is what lifts `ask`'s honest block.

Half 1 alone gets a credential stored and reported; it does not make `refarm ask` work. Shipping
half 1 and calling Copilot "done" would repeat the ADR-093 mistake — a record saying implemented
where only the near half is.

**Boundary note:** this is a corporate SERPRO Copilot account. The same sovereign posture applies as
everywhere else — per-device credential, never exported as a public API key, never logged.

## D3 — The callback page consumes the brand block

The page is generic because nothing told it who it belongs to. Have it read the brand
(`commands/brand.ts`, `REFARM_BRAND_NAME` and siblings) rather than hardcoding a name or an icon —
white-label is already the repo's stated posture for downstream products, and a callback page that
hardcodes "Refarm" would be the one screen a `dgk` deployment could not rebrand.

This is polish, and it is polish only for the flows that use a browser. Device code has no callback
page at all — which is another reason D1 does not depend on D3.

## D4 — Delegating this work to the agent: what is actually possible

The operator suggested handing this to refarm's own agent on the idle OpenAI quota. Measured today:

- **The agent has no web-search tool.** Its tools are `bash`, `apply_patch` and siblings.
- It does hold `network:outbound`, and `bash` now works (the derived spawn environment landed
  today), so it **can fetch a URL it is given**. It cannot *search*.

So delegation is real but narrow: give it URLs, not questions. Usefully, the URL it needs is already
recorded — `docs/model-provider-strata.md` links pi's
`packages/ai/src/utils/oauth/github-copilot.ts`, which is the reference implementation for exactly
this flow.

A web-search capability is a legitimate future block, and it has an obvious shape under this repo's
model (a capability verb, dispatched like any other, with the provider behind it). It is not needed
for this work and should not be bundled into it.

## Order, and why

1. **D1, device code** — unblocks the phone and is Copilot's prerequisite.
2. **D2 half 1**, Copilot's TS provider — the second consumer that proves D1 generalised.
3. **D2 half 2**, the Rust runtime adapter — what actually lets `ask` use the quota.
4. **D3**, the branded page — independent, small, and only affects browser flows.

Steps 1 and 2 are where the leverage is: after them, the operator has a second idle quota available
and a login flow that works on a device with no browser — which is the same device the mesh channel
is being built for.

## Open questions

1. **Does OpenAI's subscription login support device code?** The operator believes so. Not verified
   here; the existing `openai-codex.ts` uses PKCE with a loopback callback. If it does, `openai-codex`
   becomes D1's third consumer for free and the phone gains a second provider.
2. **Where does a device-code credential live when the device is not this machine?** The token is
   granted on the phone but the model routing lives on the node. This intersects the `FARM_*` versus
   `REFARM_*` split recorded in the naming registry, and probably wants the same answer as the local
   machine's own token — which is itself an open follow-up (silo storage rather than an exported
   env var).
