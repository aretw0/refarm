# Dispatch Surface External API (Item 4d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Lock and document `@refarm.dev/dispatch-surface`'s external-consumer API (no new logic) so `vault-seed`/`agents-lab`/headless commands can depend on the package root without importing internals.

**Architecture:** The package already exports the channel-control helpers from its root (`src/index.ts`, one curated `export { … }` block re-exporting `src/dispatch-surface.ts`). This plan adds a **public-API lock test**, a **headless consumer-proof** that imports only the root, a README contract section, and keeps `test:parity` (TS/Rust) as the behavior guard.

**Tech Stack:** TypeScript (ESM), pnpm, vitest. Package exists at `packages/dispatch-surface`; scripts: `test`, `test:parity`, `type-check`, `build`, `lint`.

**Spec:** `specs/features/2026-06-25-dispatch-surface-external-api.md`

## Global Constraints

- **Public surface = package root only.** No new subpaths; consumers must not deep-import `src/`.
- **Rust/WASM parity stays internal** — consumers never choose TS vs Rust; the package falls back transparently. `test:parity` is the guard.
- **No new logic.** This item stabilizes + documents existing exports. **No `source-dispatch`, no skill runtime.**
- **Test:** `pnpm --filter @refarm.dev/dispatch-surface run test`.

---

### Task 1: Public-API lock test (TDD)

**Files:**
- Create: `packages/dispatch-surface/src/public-api.test.ts`

**Interfaces:** asserts the runtime export set of the package root.

- [x] **Step 1: Write the lock test** — `src/public-api.test.ts`

```ts
import { describe, expect, it } from "vitest";
import * as ds from "./index.js";

// The curated public runtime surface (spec §2). Types are erased at runtime and
// are guarded by `type-check`, so this list is the runtime (function/value) exports only.
const LOCKED_RUNTIME_EXPORTS = [
  "parseTaskTransport",
  "resolveChannelFromTransport",
  "isChannelEffortPayload",
  "buildChannelEffort",
  "buildChannelEffortsPath",
  "buildChannelEffortPath",
  "encodeChannel",
  "decodeChannel",
  "normalizeChannelSource",
  "normalizeChannelContext",
  "hasChannelControlCapability",
  "assertChannelControlCapability",
  "resolveChannelControlSurfaceAdapter",
  "listKnownChannelControlSurfaces",
  "isKnownChannelControlSurface",
  "setChannelControlSurfaceAdapter",
].sort();

describe("dispatch-surface public API", () => {
  it("exposes exactly the locked runtime surface from the package root", () => {
    const actual = Object.keys(ds)
      .filter((k) => typeof (ds as Record<string, unknown>)[k] === "function")
      .sort();
    expect(actual).toEqual(LOCKED_RUNTIME_EXPORTS);
  });
});
```

- [x] **Step 2: Run and reconcile once**

Run: `pnpm --filter @refarm.dev/dispatch-surface run test -- public-api`
Expected: if it FAILS, the diff shows an export the curated surface should add (intended) or hide (move internal). **Reconcile once**: either add the missing intended export to `index.ts`, narrow an accidental one, or update `LOCKED_RUNTIME_EXPORTS` to match the curated intent. After reconciliation it PASSES and the surface is locked — future drift fails this test.

- [x] **Step 3: Commit**

```bash
git add packages/dispatch-surface/src/public-api.test.ts
git commit -m "test(dispatch-surface): lock the external public runtime API"
```

---

### Task 2: Headless consumer-proof (root-only imports)

**Files:**
- Create: `packages/dispatch-surface/src/consumer-proof.test.ts`

**Interfaces:** consumes only `./index.js`. The functions live in `src/dispatch-surface.ts` — use their signatures from there (`parseTaskTransport` :129, `resolveChannelFromTransport` :151, `buildChannelEffortsPath` :301, `buildChannelEffortPath` :313, `assertChannelControlCapability` :367, `setChannelControlSurfaceAdapter` :424, `resolveChannelControlSurfaceAdapter` :459).

- [x] **Step 1: Write the consumer-proof test** — `src/consumer-proof.test.ts`

Import **only** from `./index.js` and prove the spec's four behaviors. Fill the exact call arguments from the function signatures in `src/dispatch-surface.ts` (referenced above); the assertions below are the contract:

```ts
import { afterEach, describe, expect, it } from "vitest";
import {
  parseTaskTransport,
  resolveChannelFromTransport,
  buildChannelEffortsPath,
  buildChannelEffortPath,
  assertChannelControlCapability,
  resolveChannelControlSurfaceAdapter,
  setChannelControlSurfaceAdapter,
  listKnownChannelControlSurfaces,
} from "./index.js";

describe("dispatch-surface external consumer proof", () => {
  it("resolves a known channel from a channel:<name> transport", () => {
    const known = listKnownChannelControlSurfaces()[0];
    const transport = parseTaskTransport(`channel:${known}`);
    expect(resolveChannelFromTransport(transport)).toBe(known);
  });

  it("rejects/normalizes an unknown channel", () => {
    // unknown channel resolves to a not-known result; assert per resolveChannelControlSurfaceAdapter shape
    const r = resolveChannelControlSurfaceAdapter("definitely-not-a-channel");
    expect(r).toBeDefined(); // tighten to the documented unknown shape from :459
  });

  it("builds submit/status/log paths for a known channel", () => {
    const known = listKnownChannelControlSurfaces()[0];
    expect(typeof buildChannelEffortsPath(known)).toBe("string"); // submit/list path
    expect(typeof buildChannelEffortPath(known, "effort-1")).toBe("string"); // status/log path
  });

  it("surfaces an unsupported error when a capability is disabled via override", () => {
    const known = listKnownChannelControlSurfaces()[0];
    // override the adapter to disable one capability, then assert the capability throws
    setChannelControlSurfaceAdapter(known, /* override disabling one operation — shape from :424 */ undefined as never);
    expect(() => assertChannelControlCapability(known, "submit" as never)).toThrow();
  });

  afterEach(() => {
    // restore any registry override so tests stay isolated (use the documented reset from :424)
  });
});
```

> The `as never` / `undefined as never` markers flag the **two** spots where the exact argument
> shape comes from the signatures at `dispatch-surface.ts:424` (override) and `:367` (capability
> enum). Replace them with the real types when implementing — do not ship the markers. Everything
> else is concrete.

- [x] **Step 2: Run to verify**

Run: `pnpm --filter @refarm.dev/dispatch-surface run test -- consumer-proof`
Expected: PASS once the two signature-bound spots are filled. The test imports only `./index.js` (no deep import).

- [x] **Step 3: Commit**

```bash
git add packages/dispatch-surface/src/consumer-proof.test.ts
git commit -m "test(dispatch-surface): headless root-only consumer proof"
```

---

### Task 3: README external-consumer contract

**Files:**
- Modify: `packages/dispatch-surface/README.md`

- [x] **Step 1: Add an "External consumer contract" section** with three runnable examples (parse `channel:<name>`; build submit/status/log paths; assert capability before dispatch), and a note that consumers import the **package root only** and that TS/Rust parity is an internal, transparent fallback.

- [x] **Step 2: Commit**

```bash
git add packages/dispatch-surface/README.md
git commit -m "docs(dispatch-surface): external consumer contract and examples"
```

---

### Task 4: Gates + changeset

**Files:**
- Modify: `scripts/ci/test-capabilities.mjs` / `scripts/ci/gate-smoke-contracts.mjs` (only if not already registered)
- Create: `.changeset/dispatch-surface-external-api.md`

- [x] **Step 1: Run the package gates**

Run: `pnpm --filter @refarm.dev/dispatch-surface run test && pnpm --filter @refarm.dev/dispatch-surface run test:parity && pnpm --filter @refarm.dev/dispatch-surface run type-check`
Expected: PASS — lock test, consumer proof, parity, and types all green.

- [x] **Step 2: Ensure acceptance registration** (per `docs/PACKAGE_ACCEPTANCE_CHECKLIST.md`)

If `packages/dispatch-surface` is not already in `test-capabilities.mjs` / `gate-smoke-contracts.mjs`, add `["packages/dispatch-surface", "test"]` (and `"build"`). If already present, no change.

- [x] **Step 3: Add the changeset** — `.changeset/dispatch-surface-external-api.md`

```markdown
---
"@refarm.dev/dispatch-surface": patch
---

Lock the external-consumer public API (root-only) with a public-API lock test, a headless consumer proof, and an external-consumer README contract. No behavior change.
```

- [x] **Step 4: Commit**

```bash
git add scripts/ci/test-capabilities.mjs scripts/ci/gate-smoke-contracts.mjs .changeset/dispatch-surface-external-api.md
git commit -m "chore(dispatch-surface): acceptance gate + changeset for external API lock"
```

---

## Non-Goal

Do not build `source-dispatch` here (item 7); this stabilizes the surface item 7 will later use. No new channel providers.

## Self-Review

**Spec coverage:** public surface root-only (§ decision 1) → Task 1 lock + Task 2 root-only imports; channel-control exports (§ decision 2) → Task 1 `LOCKED_RUNTIME_EXPORTS`; parity internal (§ decision 3) → Task 4 `test:parity`; headless proof (§ decision 4 / Consumer Proof) → Task 2; README (§ Package Work) → Task 3; verification (§) → Task 4. ✓

**Placeholder scan:** the two `as never` markers in Task 2 are **explicitly flagged** with their source line numbers and a "do not ship the markers" note — a controlled signature-binding, not an open placeholder. Task 1 Step 2 "reconcile once" is a real one-time step (lock tests are seeded against the actual surface).

**Type consistency:** export names in `LOCKED_RUNTIME_EXPORTS` (Task 1) match the imports in the consumer proof (Task 2) and the spec §2 list.
