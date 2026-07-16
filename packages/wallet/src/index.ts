/**
 * @refarm.dev/wallet — the sovereign citizen's wallet as a reusable capability block.
 *
 * The wallet's whole capability core: import/verify/hold credentials, purpose-bound consent with
 * selective disclosure of the citizen's VERIFIED attributes, auditable revocation, a sandboxed WASM
 * signer, and the interactive web surface. Both the `wallet-t2` example and the citizen hub compose
 * from these exports — neither depends on the other.
 */
export * from "./persona.js";
export * from "./sovereign.js";
export * from "./sovereignty.js";
export * from "./authorization.js";
export * from "./credentials.js";
export * from "./verifier.js";
export * from "./consent.js";
export * from "./disclosure-graph.js";
export * from "./recovery.js";
export * from "./fixture.js";
