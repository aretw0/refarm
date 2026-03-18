# Sovereign Stratification: Hybrid Management Policy (JS/TS)

## Overview
Refarm is an agnostic monorepo. The coexistence of pure JavaScript and TypeScript is not a failure, but a **stratification of maturity and performance**. However, to prevent the environment from "getting in the way," we need clear rules.

## 1. Package Classification
Every package in `packages/` should follow one of these categories:

### A. TS-Strict (The Standard)
- **Definition**: Complex packages with domain logic or WIT contracts.
- **Rule**: All `.js` files inside `src/` are considered **accidental derivatives** and should be ignored/removed.
- **Identification**: Presence of a `tsconfig.build.json`.
- **Examples**: `@refarm.dev/tractor`, `@refarm.dev/heartwood`.

### B. JS-Atomic (Stable/Low-level)
- **Definition**: Thin wrappers, infrastructure scripts, or stable utilities.
- **Rule**: The `.js` files in `src/` are the **Source of Truth**.
- **Examples**: `@refarm.dev/health`, `@refarm.dev/silo`.

## 2. Control via Tools
1. **Resolution (`reso.mjs`)**: Now uses the presence of TypeScript configuration to intelligently toggle entry points.
2. **Hygiene**: Cleanup scripts must check the package classification before purging derivatives.

## 3. Is Hybrid Worth It?
**Yes, with criteria.**
- **TS** for "Engine" or "Domain" (where contracts matter).
- **JS** for "Pipe" or "Tooling" (where zero-transpilation boot speed and stability matter).

## 4. Recommendations
We keep orchestration packages (`health`, `cli`) in **Pure JS (ESM)** to ensure Refarm can always diagnose itself even if the TS compiler fails. All other domain packages should move to **TS-Strict** for contractual robustness.

## 5. Expected Build Behavior
Because of this hybrid nature, build tools like Vite or Astro may warn about externalizing Node.js modules (e.g., `node:fs`) when bundling packages for the browser.

This is **expected and managed** via conditional exports and stubs. For a detailed list of these "no-action" warnings and other technical hurdles, see **[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md#category-8-build-artifacts--bundler-noise)**.

---

> "We cultivate the code as we cultivate the soil: with patience, honesty, and respect for the cycle."
