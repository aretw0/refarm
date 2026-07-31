/**
 * `@refarm.dev/emoji-sas-v1` — a surface proves it is the operator's, and receives a
 * credential it never typed.
 *
 * Design: `docs/superpowers/specs/2026-07-31-emoji-sas-scoped-credential-design.md`
 * (S1–S5), implementing E3 of the phone-initiated-enrolment design.
 *
 * ZERO DEPENDENCIES, and that is a requirement rather than a boast: the same primitive
 * has to work in the browser, on the node, and in the zero-dependency kit.
 * `packages/prompt-contract-v1` is the precedent.
 *
 * The four things that must not be got wrong, each in its own file and each documented
 * where it lives:
 *   - `transcript.ts` — S2. The emoji come from the TRANSCRIPT, never the raw secret.
 *   - `emoji.ts` — Matrix's 64, and 7 of them. Both are security parameters.
 *   - `scoped-credential.ts` — S3. Why the entry does NOT go in `credentials[]`.
 *   - `http.ts` — E2's bounds, and why there is no confirm route here.
 */

export * from "./base64url.js";
export * from "./emoji.js";
export * from "./exchange.js";
export * from "./http.js";
export * from "./initiator.js";
export * from "./scoped-credential.js";
export * from "./store.js";
export * from "./transcript.js";
