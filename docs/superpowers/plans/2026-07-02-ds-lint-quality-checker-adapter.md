# ds-lint → quality:v1 Checker Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wrap the shipped `ds-lint:v1` engine (`packages/ds/src/lint.ts`) as a `quality:v1` **ui** `QualityChecker`, so the ecosystem has one lint model (`quality:v1`) with `ds-lint` as its ui implementation — *align, don't rebuild*.

**Architecture:** A thin adapter in `@refarm.dev/ds` (the checker side depends on the contract, never the reverse). It maps a `quality:v1` `QualityProfile` → `DsLintOptions` (which ds rules to run), calls `runDsLint(snapshot, options)`, and maps each `DsLintIssue` → `Finding`. `@refarm.dev/ds` gains a dependency on `@refarm.dev/quality-contract-v1`.

**Tech Stack:** TypeScript (ESM), vitest, the DS package build.

## Global Constraints

- Adapter lives in `@refarm.dev/ds` (new file `src/quality-checker.ts`, new export `./quality-checker`).
- `@refarm.dev/ds` adds a dependency on `@refarm.dev/quality-contract-v1` (the contract implemented in `a3820bfe`).
- Do NOT modify `ds-lint`'s own API — `ds-lint:v1` stays as-is; the adapter only wraps it.
- Exact types (from `packages/ds/src/lint.ts`): `DsLintSnapshot { viewport, elements }`, `DsLintSeverity = "error" | "warning"`, `DsLintIssue { ruleId, severity, message, elementId?, selector?, details? }`, `DsLintOptions { contrast?, overflow?, fluidType?, headingHierarchy?, tolerancePx? }`, `runDsLint(snapshot, options): DsLintReport { pass, issues, ... }`. quality:v1 types from `@refarm.dev/quality-contract-v1`: `Finding { severity, ruleId, message, locus? }`, `QualityChecker { checkerId, domain, check(subject, profile) }`, `QualityProfile { name, rules }`.

---

### Task 1: The adapter (`createDsQualityChecker`)

**Files:**
- Modify: `packages/ds/package.json` (add dependency)
- Create: `packages/ds/src/quality-checker.ts`
- Create: `packages/ds/src/quality-checker.test.ts`
- Modify: `packages/ds/package.json` `exports` (add `./quality-checker`) + `packages/ds/src/index.ts` if it barrels

**Interfaces:**
- Consumes: `runDsLint`, `DsLintOptions`, `DsLintSnapshot` from `./lint.js`; `Finding`, `QualityChecker`, `QualityProfile` from `@refarm.dev/quality-contract-v1`.
- Produces: `createDsQualityChecker(): QualityChecker` (checkerId `"ds-lint"`, domain `"ui"`).

- [ ] **Step 1: Add the dependency**

In `packages/ds/package.json`, add to `dependencies`: `"@refarm.dev/quality-contract-v1": "workspace:*"`. Add the export:
```json
"./quality-checker": { "import": "./dist/quality-checker.js", "types": "./dist/quality-checker.d.ts" }
```
Then `pnpm install`.

- [ ] **Step 2: Write the failing test**

```ts
// packages/ds/src/quality-checker.test.ts
import { describe, expect, it } from "vitest";
import { createDsQualityChecker } from "./quality-checker.js";
import type { DsLintSnapshot } from "./lint.js";
import type { QualityProfile } from "@refarm.dev/quality-contract-v1";

const lowContrast: DsLintSnapshot = {
  viewport: { width: 390, height: 844 },
  elements: [
    {
      id: "e1",
      selector: "p.lead",
      tagName: "p",
      text: "hard to read",
      styles: { color: "#777777", backgroundColor: "#888888", fontSizePx: 16, fontWeight: 400 },
    },
  ],
};

const uiProfile: QualityProfile = {
  name: "design-default",
  rules: [{ id: "contrast-aa", severity: "fail", description: "WCAG AA contrast", check: { type: "contrast" } }],
};

describe("createDsQualityChecker", () => {
  it("is a quality:v1 ui checker", () => {
    const c = createDsQualityChecker();
    expect(c.checkerId).toBe("ds-lint");
    expect(c.domain).toBe("ui");
  });

  it("maps a ds contrast issue to a quality:v1 Finding", () => {
    const findings = createDsQualityChecker().check(lowContrast, uiProfile);
    expect(findings.length).toBeGreaterThan(0);
    const f = findings.find((x) => x.ruleId === "ds-contrast");
    expect(f).toBeTruthy();
    expect(f?.severity).toBe("fail");                 // "error" -> "fail"
    expect(f?.locus?.selector).toBe("p.lead");        // locus carries the DOM location
  });

  it("only runs the ds rules the profile selects", () => {
    const overflowOnly: QualityProfile = {
      name: "p",
      rules: [{ id: "no-overflow", severity: "fail", description: "no overflow", check: { type: "overflow" } }],
    };
    // low-contrast snapshot, but contrast is NOT selected -> no ds-contrast finding
    const findings = createDsQualityChecker().check(lowContrast, overflowOnly);
    expect(findings.some((f) => f.ruleId === "ds-contrast")).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @refarm.dev/ds test -- quality-checker`
Expected: FAIL — `createDsQualityChecker` not found.

- [ ] **Step 4: Write the adapter**

```ts
// packages/ds/src/quality-checker.ts
import type { Finding, QualityChecker, QualityProfile } from "@refarm.dev/quality-contract-v1";
import { runDsLint, type DsLintOptions, type DsLintSnapshot } from "./lint.js";

/** ds-lint severities ("error" | "warning") mapped to quality:v1's fail/warn vocabulary. */
const SEVERITY_MAP: Record<string, string> = { error: "fail", warning: "warn" };

/** A quality:v1 rule's `check.type` selects which ds-lint check runs. */
const CHECK_TYPE_TO_OPTION: Record<string, keyof DsLintOptions> = {
  contrast: "contrast",
  overflow: "overflow",
  "fluid-type": "fluidType",
  "heading-hierarchy": "headingHierarchy",
};

/**
 * A `quality:v1` ui checker wrapping the `ds-lint:v1` engine. The profile selects which ds rules run
 * (ds-lint owns the rule logic); `subject` is a `DsLintSnapshot` the host collected from a rendered page.
 */
export function createDsQualityChecker(): QualityChecker {
  return {
    checkerId: "ds-lint",
    domain: "ui",
    check(subject: unknown, profile: QualityProfile): Finding[] {
      const options: DsLintOptions = {
        contrast: false,
        overflow: false,
        fluidType: false,
        headingHierarchy: false,
      };
      for (const rule of profile.rules) {
        const opt = CHECK_TYPE_TO_OPTION[rule.check.type];
        if (opt) options[opt] = true;
      }
      const report = runDsLint(subject as DsLintSnapshot, options);
      return report.issues.map((issue) => ({
        severity: SEVERITY_MAP[issue.severity] ?? issue.severity,
        ruleId: issue.ruleId,
        message: issue.message,
        locus: { elementId: issue.elementId, selector: issue.selector, ...(issue.details ?? {}) },
      }));
    },
  };
}
```

- [ ] **Step 5: Export it**

Add to `packages/ds/src/index.ts` (if it barrels exports): `export { createDsQualityChecker } from "./quality-checker.js";`

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @refarm.dev/ds test -- quality-checker`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ds
git commit -m "feat(ds): quality:v1 ui checker adapter over ds-lint:v1"
```

---

### Task 2: Conformance proof + build

**Files:**
- Modify: `packages/ds/src/quality-checker.test.ts` (append)

**Interfaces:**
- Consumes: `runQualityV1Conformance` from `@refarm.dev/quality-contract-v1`.

- [ ] **Step 1: Write the conformance test** (append)

```ts
import { runQualityV1Conformance } from "@refarm.dev/quality-contract-v1";

describe("ds ui checker conformance", () => {
  it("conforms to the quality:v1 envelope", async () => {
    const result = await runQualityV1Conformance(createDsQualityChecker(), {
      subject: lowContrast,
      profile: uiProfile,
      oddSeverityProfile: uiProfile, // severity comes from ds-lint, not the profile; must not throw
    });
    expect(result.pass, JSON.stringify(result.failures)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @refarm.dev/ds test -- quality-checker`
Expected: PASS (all four tests).

- [ ] **Step 3: Build + package validation**

Run: `pnpm --filter @refarm.dev/ds build && node scripts/validate-packages.mjs`
Expected: emits `dist/quality-checker.js`; the DS package conforms; EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add packages/ds
git commit -m "test(ds): prove the ds ui checker conforms to quality:v1"
```

---

## Self-Review

- **Coverage:** adapter (Task 1) maps profile→options, `DsLintIssue`→`Finding`, and the severity vocabulary; profile selection is proven (overflow-only omits contrast); conformance (Task 2) proves the envelope. `ds-lint:v1` is untouched.
- **Placeholder scan:** none — real fixture (`lowContrast`), real types, real commands.
- **Type consistency:** `createDsQualityChecker` returns `QualityChecker`; `check` returns `Finding[]`; `CHECK_TYPE_TO_OPTION` values are `keyof DsLintOptions`; the conformance sample matches `runQualityV1Conformance`'s `{ subject, profile, oddSeverityProfile }` signature from the quality-contract-v1 plan.
- **Note:** if `runQualityV1Conformance`'s implemented signature differs from the plan (the package kept a richer envelope per `bb10f4b5`), adjust the sample argument shape to the shipped API — the mapping logic is unaffected.
