# wallet-t2 — the sovereign citizen's digital wallet (T2)

A per-work POC app: its own CLI (`dgk`), extending the
multi-surface substrate for **one persona** — a sovereign citizen. Presented in
**result mode**: the citizen sees their own data as a product (their wallet), not the
machine. Local-first — the citizen's data lives with them.
Set `DGK_COMMAND` when you want a different binary name for white-label use.

## What it demonstrates

The citizen imports, verifies, holds and curates their own items:

```bash
dgk wallet                                       # my wallet - the items I hold
dgk import ./minha-credencial.json               # import a credential I hold (local-first)
dgk verify record:cred-<id>                      # verify it FOR REAL (signature + validity)
dgk verify record:cred-<id> --strict             # + revocation status + issuer trust
dgk share record:cred-<id>,record:cred-<other>   # SHARE only the ones I choose (a signed presentation)
dgk verify-presentation ./presented.json         # THE OTHER SIDE: the service validates a shared presentation
dgk recover <session-secret>                     # lost device → recover my sovereign identity
dgk wallet                                       # a verified credential now shows as verified
dgk serve                                        # my wallet on a web surface
```

`import` reads a Verifiable Credential (W3C VC JSON) the citizen holds — no network, local-first
— and adds it to the wallet as a **draft** (unverified). `verify` then checks it **for real**
via the substrate's W3C verifier (`@refarm.dev/credentials-contract-v1`): the issuer's
signature over the credential, issuer trust, revocation and validity. Only a credential that
actually verifies is promoted to `verified` (the state the wallet shows); a tampered or unsigned
credential is rejected and stays draft, with the failed checks reported. This is a real
verification — not a review-state flip. Out of the box the verifier is an in-memory fixture (so
`import`→`verify` works offline and is testable); a real deployment binds it to the citizen's
identity/storage or a trust registry. **Sovereign mode is shipped:** run with `DGK_SOVEREIGN=1`
and the citizen's identity becomes a sandboxed Ed25519 WASM signer
(`@refarm.dev/identity-provider-ref`) — every presentation `share`/`present` builds is signed
*inside the sandbox*, the wallet process never holding the private key. The difference between
"my data, my wallet" as a slogan and as a guarantee. QR import parses a QR payload behind the
`import --qr` flag (raw / base64url / offer-url); file-JSON import is the default path.

`share` is the sovereignty move — the point of the whole Carteira Digital: the citizen
**compartilha apenas o estritamente necessário**. They pick which credentials go into a
**Verifiable Presentation signed by them** (the holder); anything they didn't choose is never
disclosed. The receiving party then verifies the presentation — each credential is genuine AND
the holder who presents is who signed it. Selection is per-credential (revealing individual
fields within a credential, SD-JWT/BBS+ style, isn't in the substrate's VC model yet); even so,
it is private-by-default sharing under the citizen's control.

`verify` enforces a real policy (not signature alone): the default requires **validity** (an
expired credential is rejected — a bare signature check silently accepted it); `--strict` adds
**revocation status** (re-reading the issuer's signed status list) and **issuer trust** against a
**trust registry**. The registry is the allow-list of civic issuers a deployment pins (via the
bundle's `verifyPolicy`): a credential whose signature is perfectly valid but whose issuer is NOT
on the list is **rejected** — the anti-fraud point ("emissor não-confiável recusado mesmo com
assinatura válida"). With no registry configured the wallet self-trusts (offline default), so the
rejection is reachable exactly when a real deployment pins its list. Both sides of the exchange ship: `verify-presentation`
is the **receiving service's** verb — it validates a presentation the citizen shared (holder-binding
always; `--strict` for revocation + trust), so the demo shows *present AND accept*, not presenting
into the void. The revocation chain is proven end to end: an issuer revokes a credential and the
wallet's `--strict` re-verify then rejects it, discovered from the status list with no re-import.

`recover <session-secret>` is the **sovereignty guarantee made concrete**: a lost device does not
lose the identity. The citizen re-authenticates (OPAQUE/WebAuthn → a session secret) and the
provider's `deriveFromSession` deterministically re-derives the SAME identity — same id, same
public key — restoring the ability to sign *without ever exposing the key*. Your identity is
yours, not the device's.

`dgk status --base --json` is the manual exploratory entrypoint for the shared
operator-state contract. The app declares a white-label `dgk` host with
`defineCapabilityHost` from `@refarm.dev/capability-host`; the platform composes the
registry, CLI, HTTP surface, and base status capability. The example keeps only the
wallet-specific extension: its records, `wallet` persona verb, and wallet review
unit.

`dgk actions --json` projects the base model actions into selectable surface rows
(`open-wallet`, `verify-draft-credential`) with intents and command payloads. Web, TUI,
headless, and agent surfaces can read the same action declaration instead of each
surface inventing its own buttons.

The CLI persists local curation to `.dgk/wallet.manifest.json` by default, so a
correction made in one process is visible to the next command. That state is wired
through `@refarm.dev/capability-host/node`, not app-local file IO. Set
`DGK_WALLET_STATE_PATH=/path/to/manifest.json` to record an isolated run, or delete
`.dgk/` to reset the demo state.
Set `DGK_COMMAND=/path/to/cli-name` to change the CLI command root (for example
`DGK_COMMAND=wallet-acme`).

`wallet` renders the citizen's held items grouped by verification status — the
product view. It reads the neutral `records analyze` envelope; the citizen never sees
that engine. The focus is the benefit ("my data, my wallet"), the opposite of T1's
process view.

## Two layers

- **Generic (platform, unchanged):** the neutral `source` / `records` / `vault` chain.
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
(the risk the design note warns about: without a real screen, this falls into "just
another generic solution"). CLI barely matters here — at most mention how a citizen
installs the POC (a powershell / linux line).

**The reference to draw on: `apps/me`.** apps/me is the "Sovereign Citizen Hub" (Astro,
its own runtime/surfaces/PWA). T2 is the same idea — the citizen's daily portal. The
wallet dashboard extends the neutral web surface (`serveWebUi` from
`@refarm.dev/capability-host`) and/or mirrors apps/me's shape. Local-first, sovereign
over the data.

**What to build for a rich demo.**
- The wallet as an EXTENSION (a work verb, or a plugin the citizen installs) — NOT baked
  into the base platform. The base platform ships the surface machine; the wallet is the citizen's app on top.
- A real WEB dashboard the citizen operates (the screens matter most here) — extend
  `serveWebUi` with the wallet's own cards + a citizen-facing look, and/or the apps/me
  runtime.
- The results the work wants to show: the citizen curating, verifying, holding their own
  records with sovereignty.

**What stays generic (platform) vs specific (here).** The base platform ships the neutral chain + the
CLI/TUI/web surface machine (verbs + REPL). This app supplies the citizen persona, the
wallet vocabulary, and the extended dashboard. Swap the persona, keep the machine.
