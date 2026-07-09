# wallet-t2 — the sovereign citizen's digital wallet (T2)

A per-work POC app: its own CLI (`dgk`), extending the
multi-surface substrate for **one persona** — a sovereign citizen. Presented in
**result mode**: the citizen sees their own data as a product (their wallet), not the
machine. Local-first — the citizen's data lives with them.

## What it demonstrates

The citizen holds and curates their own items:

```bash
dgk status --base --json                         # base operator model for this app
dgk actions --json                               # selectable multi-surface actions
dgk wallet                                       # my wallet - the items I hold
dgk records correct record:cred-assinatura verified --apply   # I verify a credential
dgk wallet                                       # it now shows as verified
dgk serve                                        # my wallet on a web surface
```

`dgk status --base --json` is the manual exploratory entrypoint for the shared
operator-state contract. The app declares a white-label `dgk` host with
`defineCapabilityHost` from `@refarm.dev/capabilities-v1`; Refarm composes the
registry, CLI, HTTP surface, and base status capability. The example keeps only the
wallet-specific extension: its records, `wallet` persona verb, and wallet review
unit.

`dgk actions --json` projects the base model actions into selectable surface rows
(`open-wallet`, `verify-draft-credential`) with intents and command payloads. Web, TUI,
headless, and agent surfaces can read the same action declaration instead of each
surface inventing its own buttons.

The CLI persists local curation to `.dgk/wallet.manifest.json` by default, so a
correction made in one process is visible to the next command. That state is wired
through `@refarm.dev/capabilities-v1/node`, not app-local file IO. Set
`DGK_WALLET_STATE_PATH=/path/to/manifest.json` to record an isolated run, or delete
`.dgk/` to reset the demo state.

`wallet` renders the citizen's held items grouped by verification status — the
product view. It reads the neutral `records analyze` envelope; the citizen never sees
that engine. The focus is the benefit ("my data, my wallet"), the opposite of T1's
process view.

## Two layers

- **Generic (refarm, unchanged):** the neutral `source` / `records` / `vault` chain.
  It knows nothing about wallets, credentials, or citizens.
- **Specific (this app):** `src/fixture.ts` holds the citizen's own items;
  `src/persona.ts` declares `wallet`, which projects the neutral analyze envelope
  into the wallet view. A different work swaps this persona (an analyst bench, a dev
  view) and the neutral blocks are untouched.

## Run it

```bash
pnpm --filter wallet-t2 build
pnpm --filter wallet-t2 dgk status --base --json
pnpm --filter wallet-t2 dgk actions --json
pnpm --filter wallet-t2 dgk wallet
pnpm --filter wallet-t2 dgk records correct record:cred-assinatura verified --apply
pnpm --filter wallet-t2 dgk status --base --json
# web surface:
pnpm --filter wallet-t2 dgk serve --port 4322
# → GET http://127.0.0.1:4322/capabilities/wallet
# → GET http://127.0.0.1:4322/docs/openapi.json
```

## Focus — what T2 makes shine (survives our design conversation)

**Persona & mode.** The sovereign citizen; **result mode** — present the PRODUCT /
benefit, not the machine. The citizen sees their data as a wallet and enjoys it. The
focus is the advance the work brings, not the technique.

**The scenario to record.** A citizen running something **local-first** for their own
benefit: their digital wallet over their own data, with an **extended web dashboard**
(the risk the SERPRO note warns about: without a real screen, T2 falls into "just
another generic solution"). CLI barely matters here — at most mention how a citizen
installs the POC (a powershell / linux line).

**The reference to draw on: `apps/me`.** apps/me is the "Sovereign Citizen Hub" (Astro,
its own runtime/surfaces/PWA). T2 is the same idea — the citizen's daily portal. The
wallet dashboard extends the neutral web surface (`serveWebUi` from
`@refarm.dev/capabilities-v1`) and/or mirrors apps/me's shape. Local-first, sovereign
over the data.

**What to build for a rich demo.**
- The wallet as an EXTENSION (a work verb, or a plugin the citizen installs) — NOT baked
  into refarm. refarm ships the surface machine; the wallet is the citizen's app on top.
- A real WEB dashboard the citizen operates (the screens matter most here) — extend
  `serveWebUi` with the wallet's own cards + a citizen-facing look, and/or the apps/me
  runtime.
- The results the work wants to show: the citizen curating, verifying, holding their own
  records with sovereignty.

**What stays generic (refarm) vs specific (here).** refarm ships the neutral chain + the
CLI/TUI/web surface machine (verbs + REPL). This app supplies the citizen persona, the
wallet vocabulary, and the extended dashboard. Swap the persona, keep the machine.
