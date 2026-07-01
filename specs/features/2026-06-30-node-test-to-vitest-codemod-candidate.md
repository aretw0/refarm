# Spec: `node:test` → Vitest codemod

**Status:** READY — local fixtures/dry-run landed; consumer migration remains proof-gated.
Consumer pressure from a JS-first project on `node:test`.
**Authors:** Arthur Silva, Claude
**Date:** 2026-06-30
**Related:** `docs/ECOSYSTEM_SUPPLY_MAP.md` (generator/codemod registry lane), Refarm test stack
(Vitest), the convergence doctrine (Refarm supplies reusable substrate incl. codemods)

---

## Context & Motivation

Refarm's test stack is **Vitest** (TS-native): `turbo run test` → per-package `vitest run`, with
TypeScript tests (e.g. `records-contract-v1/src/yaml.test.ts`). A downstream consumer project is on
**`node:test`** (JS/MJS only) with **no TS-test capability** — so its TypeScript logic (e.g. a site's
graph/data layer) cannot be unit-tested, and its stack diverges from Refarm's.

Aligning that consumer to Vitest is a **mechanical** rewrite, not a rethink: measured on the consumer,
68 test files / ~1817 assertions, with a **concentrated** assert surface (top 6 —
`match`/`equal`/`ok`/`deepEqual`/`doesNotMatch`/`rejects` — ≈95%). Refarm already promotes codemods
for its own migrations; a generic **`node:test` → Vitest codemod** is a reusable block: Refarm owns it,
consumers (the vault, `agents-lab`, any node:test project) run it to reach the shared stack.

## Decision

A codemod in Refarm's codemod registry that transforms a `node:test` suite to Vitest:

- **imports:** `import test from "node:test"` / `node:test` named imports → `import { test, it, describe,
  expect } from "vitest"`; drop simple default `node:assert/strict` imports.
- **assertions:** `assert.equal→toBe`, `assert.deepEqual→toEqual`, `assert.match→toMatch`,
  `assert.doesNotMatch→not.toMatch`, `assert.ok→toBeTruthy`, `assert.notEqual→not.toBe`,
  `assert.throws→toThrow`, and async `assert.rejects → await expect(...).rejects...`.
  Preserve the optional message argument as the `expect` message where Vitest supports it.
- **mocks/lifecycle:** `describe`/`beforeEach` map straight; simple `before`/`after` calls map to
  `beforeAll`/`afterAll`; `mock.*` namespace uses map to `vi.*`.
- **safety:** anything the codemod does not recognize is **left intact and reported** for manual review
  — the codemod never silently drops or mis-rewrites an assertion, and keeps the assert import when
  an unhandled `assert.*` remains.

It does **not** own: the consumer's Vitest config, coverage thresholds, or test conventions — those
stay downstream.

## Consumer pressure & gate

First pressure: the vault consumer (68 files, ~1817 asserts). The local Refarm gate promotes the
codemod to **ready** because fixtures, dry-run JSON, rollback notes, and registry coverage exist. It
does not become **implemented** until Refarm dogfoods it or the consumer migration proves it.

## First proof shape

1. run the codemod on the consumer's 68 files;
2. ~95% of assertions transform automatically; the ~15 files using `mock.`/`describe`/`beforeEach` and
   the async `rejects`/`throws` edge cases get flagged for a short manual pass;
3. the migrated suite is **green** under `vitest run` with no lost coverage;
4. an unhandled-node report lists anything the codemod left for manual review (empty or triaged).

## Non-Goals

- No Vitest config, coverage policy, or CI wiring in the codemod (downstream product).
- No behavioral change to the tests — only the runner/API is rewritten.
- No forced migration; a project opts in by running the codemod.
