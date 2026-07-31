/**
 * `@refarm.dev/attend-web-v1` — the browser's half of a pending prompt.
 *
 * The pending-prompt design (P6) said three consumers would read the shape: the stdio
 * adapter, the attending kit command, and later a browser, "where it proves the
 * abstraction instead of inventing it". This is that third consumer, and it added nothing
 * to the wire — every route, status and field it reads was already there.
 *
 * Design: `docs/superpowers/specs/2026-07-30-pending-prompt-wire-design.md` (P1–P6) and
 * `docs/superpowers/specs/2026-07-31-emoji-sas-scoped-credential-design.md` (S3).
 *
 * ZERO DEPENDENCIES, and browser-first: the emitted JavaScript imports nothing at all, so
 * it can be served straight to a page from the node's own listener. The types come from
 * `@refarm.dev/prompt-contract-v1` through `import type`, which erases — see `wire.ts`
 * for why the block's runtime code cannot be loaded in a browser and what keeps this copy
 * from drifting from it.
 *
 * The four things worth not getting wrong, each in its own file:
 *   - `refusal.ts` — 401, 409 and unreachable are three different things.
 *   - `credential.ts` — S3. Why storing THIS credential is defensible, and the three
 *     rules that keep it so.
 *   - `poll.ts` — the node advertises `pollIntervalMs`; a surface does not invent a
 *     faster one.
 *   - `view.ts` — P4 and P6. Each kind as data, so rendering is testable without a
 *     browser.
 */

export * from "./client.js";
export * from "./credential.js";
export * from "./poll.js";
export * from "./refusal.js";
export * from "./view.js";
export * from "./wire.js";
