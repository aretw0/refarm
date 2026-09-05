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
 * Browser-first: its only runtime dependency is the runtime-neutral HTML projection from
 * `@refarm.dev/ds`; both can be served straight from the node's own listener. Contract
 * types still erase at build time — see `wire.ts` for what keeps the browser wire copy
 * from drifting from the canonical prompt block.
 *
 * The four things worth not getting wrong, each in its own file:
 *   - `refusal.ts` — 401, 409 and unreachable are three different things.
 *   - `credential.ts` — S3. Why storing THIS credential is defensible, and the three
 *     rules that keep it so.
 *   - `poll.ts` — the node advertises `pollIntervalMs`; a surface does not invent a
 *     faster one.
 *   - `view.ts` — P4 and P6. Each kind as data, so rendering is testable without a
 *     browser.
 *   - `render.ts` — the shared DS projection; consuming apps bind behaviour only.
 */

export * from "./client.js";
export * from "./credential.js";
export * from "./poll.js";
export * from "./refusal.js";
export * from "./render.js";
export * from "./view.js";
export * from "./wire.js";
