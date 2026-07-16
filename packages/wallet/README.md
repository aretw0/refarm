# @refarm.dev/wallet

The sovereign citizen's wallet as a **reusable capability block**. It wires the framework's
contract blocks (`authorization-contract-v1`, `credentials-contract-v1`, `identity-provider-ref`,
`records-contract-v1`, `history-contract-v1`) into a wallet: import/verify/hold credentials,
purpose-bound consent with **selective disclosure of the citizen's VERIFIED attributes**, auditable
revocation, and a **sandboxed WASM signer** (the private key never leaves the boundary).

Consumed by both the `wallet-t2` example (the POC that proves it) and the citizen hub (`apps/me`) —
neither depends on the other; both compose this block. See
[`docs/superpowers/specs/2026-07-16-wallet-block-apps-me-convergence.md`](../../docs/superpowers/specs/2026-07-16-wallet-block-apps-me-convergence.md).

## Public API

- `walletCapabilityBundle(options)` / `createWalletCapabilities(records, options)` — the wallet verbs.
- `walletWebSurface(registry)` — the interactive web surface (dispatch loop + arg forms).
- `createSovereignWalletBundle()` — the WASM-signer backing (identity + credentials + authorization).
- `buildSovereigntyReport(recordsDeps)` — the citizen's whole posture in one view.
