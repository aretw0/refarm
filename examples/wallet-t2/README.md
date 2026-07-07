# wallet-t2 — the sovereign citizen's digital wallet (T2)

A per-work POC app: its own CLI (`wallet`), refarm underneath, extending the
multi-surface substrate for **one persona** — a sovereign citizen. Presented in
**result mode**: the citizen sees their own data as a product (their wallet), not the
machine. Local-first — the citizen's data lives with them.

## What it demonstrates

The citizen holds and curates their own items:

```bash
wallet wallet-show                                  # my wallet — the items I hold
wallet records correct record:cred-assinatura verified --apply   # I verify a credential
wallet wallet-show                                  # it now shows as verified
wallet serve                                        # my wallet on a web surface
```

`wallet-show` renders the citizen's held items grouped by verification status — the
product view. It reads the neutral `records analyze` envelope; the citizen never sees
that engine. The focus is the benefit ("my data, my wallet"), the opposite of T1's
process view.

## Two layers

- **Generic (refarm, unchanged):** the neutral `source` / `records` / `vault` chain.
  It knows nothing about wallets, credentials, or citizens.
- **Specific (this app):** `src/fixture.ts` holds the citizen's own items;
  `src/persona.ts` declares `wallet-show`, which projects the neutral analyze envelope
  into the wallet view. A different work swaps this persona (an analyst bench, a dev
  view) and the neutral blocks are untouched.

## Run it

```bash
pnpm --filter wallet-t2 build
pnpm --filter wallet-t2 wallet wallet-show
# web surface:
pnpm --filter wallet-t2 wallet serve --port 4322
# → GET http://127.0.0.1:4322/capabilities/wallet
```
