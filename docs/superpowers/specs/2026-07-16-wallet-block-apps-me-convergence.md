# Convergence: a reusable wallet block, mounted in the citizen hub

> Status: design (2026-07-16). Grounded in the current tree. The goal Arthur set: the BEST
> long-term shape — a mix of refactoring `apps/me` and mounting the wallet, using the full stack,
> not a throwaway coupling.

## The constraint that fixes the shape

- `apps/me` (`@refarm.me/app`) is **published** (`private: false`).
- `examples/wallet-t2` is a **private** example.

A published product **cannot depend on a private example**. So "apps/me imports wallet-t2" is not a
long-term option — it would break publish. The clean shape is therefore forced and correct:

> Extract the wallet's REUSABLE capability core into a **publishable block**. Both the example
> (`wallet-t2`, the POC that proves it) and the product (`apps/me`, the citizen hub that uses it)
> consume the block. Neither depends on the other; both consume the framework. This is "COMUM = 2+
> consumidores → vira bloco" made real.

## What is reusable vs. example-specific

The wallet is already built from framework blocks (`@refarm.dev/authorization-contract-v1`,
`credentials-contract-v1`, `identity-provider-ref`, `records-contract-v1`, `history-contract-v1`).
What `wallet-t2` adds on top, and where each piece belongs:

| Piece (in `examples/wallet-t2/src`) | Reusable → block | Example-only → stays |
|---|---|---|
| `persona.ts` `walletCapabilityBundle`, `createWalletCapabilities`, `walletWebSurface` | ✅ the wallet's capability wiring | |
| `authorization.ts` (authorize/present/revoke + `verifiedAttributes`) | ✅ | |
| `credentials.ts`, `verifier.ts`, `trust`, `sovereignty.ts` | ✅ | |
| `sovereign.ts` (WASM signer bundle) | ✅ | |
| `cli.ts` (`dgk` command, host command resolver, state path) | | ✅ the CLI shell |
| `report.ts` (evidence bundle wiring) | | ✅ (or a thin re-use) |
| `pages/*.astro`, `web/*.ts` (the example's own boot) | | ✅ |

So the block is roughly `persona.ts` + the verb modules; `wallet-t2` keeps `cli.ts`, the Astro pages,
and its boot, becoming a THIN consumer of the block (the same move `apps/me` makes).

## The block

New package `@refarm.dev/wallet` (name TBD): exports `buildWalletRegistry(options)` and
`walletWebSurface(registry)`. Depends on the framework contract blocks. `private: false` (publishable).

## The slices (each verifiable, dogfood-gated)

1. **Extract the block.** Create `packages/wallet`, move the reusable modules, keep public API
   (`walletCapabilityBundle` / `createWalletCapabilities` / `walletWebSurface`). Rewire `wallet-t2`
   to import from the block. Gate: `wallet-t2` suite stays green (58+ tests), byte-identical behavior.
2. **apps/me derives its personal surface from a registry.** Replace the bespoke
   `renderRefarmMePersonalSurface` with `createCapabilityWebSurfacePlugin(personalRegistry)` — the
   product dogfoods the same primitive the examples use (roadmap #4 gate). Gate: `me-surfaces.test`
   updated, `apps/me` suite green. (UX change: confirm the personal panel becoming registry cards is
   wanted, or mount BOTH — bespoke hero + capability panel.)
3. **Mount the wallet in the hub.** `apps/me` adds `@refarm.dev/wallet`, registers
   `walletWebSurface(buildWalletRegistry({ … }))` as a surface plugin (next to the chat). With the
   dispatch loop + arg forms already shipped, the citizen gets a LIVE wallet inside their hub:
   import → verify → authorize → present, in the browser. Gate: `apps/me` renders the wallet panel
   (jsdom), suite green.
4. **(Optional) sovereign backing in the hub.** Wire `DGK_SOVEREIGN`-equivalent so the hub's wallet
   signs inside the WASM sandbox, not the fixture.

## Why this is the long-term-right shape

- No product↔example coupling; the block is the single source both consume.
- `apps/me` and the examples both become thin consumers of framework primitives — the convergence
  thesis ("declare once → every surface, every consumer") proven on a real product.
- The citizen hub gains a genuinely usable wallet built from sovereign blocks, not a mock.

## Prerequisites already in place (this session)

- The web-face dispatch loop + arg-input forms (any `createCapabilityWebSurfacePlugin` surface is
  interactive) — so a mounted wallet is immediately usable, not a snapshot.
- `verifiedAttributes` — `present` discloses the citizen's verified data (the loop is honest).
- `StudioShell.rerender()` — surfaces update in place after an action.
