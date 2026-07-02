# quality:v1 Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `@refarm.dev/quality-contract-v1` — the `quality:v1` declared-lint contract (rule/finding/profile envelope + a pluggable `QualityChecker`), with a reference text checker and a conformance runner.

**Implementation note (2026-07-02):** Completed in commit `a3820bfe` as one consolidated release-lane slice instead of five TDD commits. The package intentionally kept a richer report envelope (`capability`, `checkerId`, `domain`, `profileName`) for downstream handoff clarity and chose explicit public names (`QualityFinding`, `resolveQualityProfile`, `countFindings`, `createRegexQualityChecker`, `runQualityCheck`) over the draft helper names below. The draft was useful for sequencing, but its helper names are not compatibility commitments.

**Architecture:** A pure TypeScript contract package mirroring `records-contract-v1`: `types.ts` (envelope), `reference.ts` (profile resolution + a regex-based reference checker + report assembly), `conformance.ts` (envelope conformance runner), `index.ts` (exports). The rule matcher (`check`) and finding `locus` are opaque data the checker interprets — new domains ship as checker implementations, never as contract edits.

**Tech Stack:** TypeScript (ESM), vitest, `tsc --project tsconfig.build.json`, pnpm workspace.

## Global Constraints

- Package name `@refarm.dev/quality-contract-v1`, version `0.1.0`, `"type": "module"`.
- ESM only: intra-package imports use `.js` extensions (e.g. `from "./types.js"`).
- Test framework is vitest (`vitest run`); build is `tsc --project tsconfig.build.json`.
- No runtime dependencies; Node `>=22`.
- Spec of record: `specs/features/2026-07-02-quality-contract-v1.md`. Types must match it verbatim.

---

## File Structure

- `packages/quality-contract-v1/package.json` — package manifest (mirrors records-contract-v1).
- `packages/quality-contract-v1/tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts` — TS + test config.
- `packages/quality-contract-v1/src/types.ts` — the contract envelope types.
- `packages/quality-contract-v1/src/profile.ts`, `src/reference.ts`, `src/report.ts` — profile resolution, regex reference checking, and report assembly.
- `packages/quality-contract-v1/src/conformance.ts` — `runQualityV1Conformance`.
- `packages/quality-contract-v1/src/reference.test.ts`, `src/conformance.test.ts` — tests.
- `packages/quality-contract-v1/src/index.ts` — public exports.
- `packages/quality-contract-v1/README.md` — one-paragraph package readme.

---

### Task 1: Scaffold package + contract types

**Files:**
- Create: `packages/quality-contract-v1/package.json`
- Create: `packages/quality-contract-v1/tsconfig.json`
- Create: `packages/quality-contract-v1/tsconfig.build.json`
- Create: `packages/quality-contract-v1/vitest.config.ts`
- Create: `packages/quality-contract-v1/src/types.ts`

**Interfaces:**
- Produces: `QUALITY_CAPABILITY`, `QualityRule`, `QualityProfile`, `QualityFinding`, `QualityReport`, `QualityChecker` (consumed by every later task).

- [ ] **Step 1: Copy config from the sibling contract package**

Copy `tsconfig.json`, `tsconfig.build.json`, and `vitest.config.ts` verbatim from `packages/records-contract-v1/` into `packages/quality-contract-v1/` (same TS target, module, and vitest settings — do not diverge).

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "@refarm.dev/quality-contract-v1",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "clean": "rm -rf dist"
  },
  "files": ["dist", "!dist/**/*.tsbuildinfo", "README.md"],
  "license": "AGPL-3.0-only"
}
```

- [ ] **Step 3: Write `src/types.ts`** (verbatim from the spec §1)

```ts
export const QUALITY_CAPABILITY = "quality:v1" as const;

/** A rule. The envelope is generic; `check` is data the checker interprets. */
export interface QualityRule {
  id: string;
  severity: string;
  description: string;
  category?: string;
  check: { type: string; [param: string]: unknown };
}

export interface QualityProfile {
  name: string;
  extends?: string;
  rules: QualityRule[];
}

export interface Finding {
  severity: string;
  ruleId: string;
  message: string;
  locus?: Record<string, unknown>;
}

export interface QualityReport {
  findings: Finding[];
  counts: Record<string, number>;
  metrics?: Record<string, unknown>;
}

export interface QualityChecker {
  readonly checkerId: string;
  readonly domain: string;
  check(subject: unknown, profile: QualityProfile): Finding[] | Promise<Finding[]>;
}
```

- [ ] **Step 4: Verify types compile**

Run: `pnpm --filter @refarm.dev/quality-contract-v1 type-check`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/quality-contract-v1
git commit -m "feat(quality): scaffold quality-contract-v1 package + envelope types"
```

---

### Task 2: Profile resolution + severity counts

**Files:**
- Create: `packages/quality-contract-v1/src/reference.ts`
- Test: `packages/quality-contract-v1/src/reference.test.ts`

**Interfaces:**
- Consumes: `QualityProfile`, `QualityRule`, `Finding` from `./types.js`.
- Produces: `resolveProfile(profile, registry?) => QualityProfile`, `severityCounts(findings) => Record<string, number>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/reference.test.ts
import { describe, expect, it } from "vitest";
import { resolveProfile, severityCounts } from "./reference.js";
import type { QualityProfile } from "./types.js";

describe("resolveProfile", () => {
  it("flattens an extends chain, child rules win by id", () => {
    const base: QualityProfile = {
      name: "base",
      rules: [
        { id: "a", severity: "warn", description: "base a", check: { type: "regex", regex: "x" } },
        { id: "b", severity: "warn", description: "base b", check: { type: "regex", regex: "y" } },
      ],
    };
    const strict: QualityProfile = {
      name: "strict",
      extends: "base",
      rules: [{ id: "a", severity: "fail", description: "strict a", check: { type: "regex", regex: "x" } }],
    };
    const resolved = resolveProfile(strict, { base, strict });
    expect(resolved.rules.map((r) => r.id).sort()).toEqual(["a", "b"]);
    expect(resolved.rules.find((r) => r.id === "a")?.severity).toBe("fail");
  });

  it("throws on a cyclic extends", () => {
    const p: QualityProfile = { name: "p", extends: "p", rules: [] };
    expect(() => resolveProfile(p, { p })).toThrow(/cyclic/);
  });
});

describe("severityCounts", () => {
  it("counts findings by severity", () => {
    expect(severityCounts([
      { severity: "warn", ruleId: "a", message: "m" },
      { severity: "warn", ruleId: "b", message: "m" },
      { severity: "fail", ruleId: "c", message: "m" },
    ])).toEqual({ warn: 2, fail: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @refarm.dev/quality-contract-v1 test`
Expected: FAIL — `resolveProfile`/`severityCounts` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/reference.ts
import type { Finding, QualityProfile, QualityRule } from "./types.js";

/** Flatten a profile's `extends` chain (base first, child rules win by id). */
export function resolveProfile(
  profile: QualityProfile,
  registry: Record<string, QualityProfile> = {},
): QualityProfile {
  const chain: QualityProfile[] = [];
  const seen = new Set<string>();
  let cur: QualityProfile | undefined = profile;
  while (cur) {
    if (seen.has(cur.name)) throw new Error(`quality: cyclic profile extends at "${cur.name}"`);
    seen.add(cur.name);
    chain.unshift(cur);
    cur = cur.extends ? registry[cur.extends] : undefined;
  }
  const byId = new Map<string, QualityRule>();
  for (const p of chain) for (const r of p.rules) byId.set(r.id, r);
  return { name: profile.name, rules: [...byId.values()] };
}

/** Count findings by severity string. */
export function severityCounts(findings: Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return counts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @refarm.dev/quality-contract-v1 test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/quality-contract-v1/src/reference.ts packages/quality-contract-v1/src/reference.test.ts
git commit -m "feat(quality): profile resolution + severity counts"
```

---

### Task 3: Reference text checker + report assembly

**Files:**
- Modify: `packages/quality-contract-v1/src/reference.ts` (append)
- Modify: `packages/quality-contract-v1/src/reference.test.ts` (append)

**Interfaces:**
- Consumes: `QualityChecker`, `QualityProfile`, `QualityReport`, `Finding` from `./types.js`; `severityCounts` from this file.
- Produces: `createReferenceTextChecker() => QualityChecker`, `runQualityReport(checker, subject, profile) => Promise<QualityReport>`.

- [ ] **Step 1: Write the failing test** (append to `reference.test.ts`)

```ts
import { createReferenceTextChecker, runQualityReport } from "./reference.js";

describe("createReferenceTextChecker", () => {
  const profile: QualityProfile = {
    name: "p",
    rules: [{ id: "no-foo", severity: "warn", description: "avoid foo", check: { type: "regex", regex: "foo" } }],
  };

  it("emits a finding per regex match with a locus", async () => {
    const checker = createReferenceTextChecker();
    const findings = await checker.check("foo bar foo", profile);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ severity: "warn", ruleId: "no-foo", message: "avoid foo" });
    expect(typeof findings[0].locus?.index).toBe("number");
  });

  it("ignores non-regex rules (matcher-is-data)", async () => {
    const checker = createReferenceTextChecker();
    const domProfile: QualityProfile = {
      name: "p2",
      rules: [{ id: "x", severity: "warn", description: "d", check: { type: "dom-selector", selector: "h1" } }],
    };
    expect(await checker.check("h1 h1", domProfile)).toEqual([]);
  });
});

describe("runQualityReport", () => {
  it("assembles findings + counts", async () => {
    const checker = createReferenceTextChecker();
    const profile: QualityProfile = {
      name: "p",
      rules: [{ id: "no-foo", severity: "warn", description: "avoid foo", check: { type: "regex", regex: "foo" } }],
    };
    const report = await runQualityReport(checker, "foo foo", profile);
    expect(report.counts).toEqual({ warn: 2 });
    expect(report.findings).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @refarm.dev/quality-contract-v1 test`
Expected: FAIL — `createReferenceTextChecker`/`runQualityReport` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `reference.ts`)

```ts
import type { QualityChecker, QualityReport } from "./types.js";

/** Reference checker for the "text" domain: applies rules whose `check.type === "regex"`. */
export function createReferenceTextChecker(): QualityChecker {
  return {
    checkerId: "reference-text",
    domain: "text",
    check(subject: unknown, profile: QualityProfile): Finding[] {
      const text = String(subject ?? "");
      const findings: Finding[] = [];
      for (const rule of profile.rules) {
        if (rule.check.type !== "regex" || typeof rule.check.regex !== "string") continue;
        const re = new RegExp(rule.check.regex, "g");
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          findings.push({
            severity: rule.severity,
            ruleId: rule.id,
            message: rule.description,
            locus: { index: m.index, match: m[0] },
          });
          if (m.index === re.lastIndex) re.lastIndex++;
        }
      }
      return findings;
    },
  };
}

/** Run a checker over a subject and assemble a report (findings + severity counts). */
export async function runQualityReport(
  checker: QualityChecker,
  subject: unknown,
  profile: QualityProfile,
): Promise<QualityReport> {
  const findings = await checker.check(subject, profile);
  return { findings, counts: severityCounts(findings) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @refarm.dev/quality-contract-v1 test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/quality-contract-v1/src/reference.ts packages/quality-contract-v1/src/reference.test.ts
git commit -m "feat(quality): reference text checker + report assembly"
```

---

### Task 4: Conformance runner

**Files:**
- Create: `packages/quality-contract-v1/src/conformance.ts`
- Test: `packages/quality-contract-v1/src/conformance.test.ts`

**Interfaces:**
- Consumes: `QualityChecker`, `QualityProfile` from `./types.js`.
- Produces: `runQualityV1Conformance(checker, sample) => Promise<ConformanceResult>`, `ConformanceResult { pass, total, failed, failures }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/conformance.test.ts
import { describe, expect, it } from "vitest";
import { runQualityV1Conformance } from "./conformance.js";
import { createReferenceTextChecker } from "./reference.js";
import type { QualityProfile } from "./types.js";

describe("runQualityV1Conformance", () => {
  const profile: QualityProfile = {
    name: "p",
    rules: [{ id: "no-foo", severity: "warn", description: "avoid foo", check: { type: "regex", regex: "foo" } }],
  };
  const oddSeverityProfile: QualityProfile = {
    name: "odd",
    rules: [{ id: "x", severity: "blocker-9000", description: "d", check: { type: "regex", regex: "foo" } }],
  };

  it("passes for a conforming checker", async () => {
    const result = await runQualityV1Conformance(createReferenceTextChecker(), {
      subject: "foo foo",
      profile,
      oddSeverityProfile,
    });
    expect(result.pass, JSON.stringify(result.failures)).toBe(true);
    expect(result.failed).toBe(0);
  });

  it("fails a checker that drops ruleId", async () => {
    const broken = {
      checkerId: "broken",
      domain: "text",
      check: () => [{ severity: "warn", ruleId: "", message: "m" }],
    };
    const result = await runQualityV1Conformance(broken, { subject: "foo", profile, oddSeverityProfile });
    expect(result.pass).toBe(false);
    expect(result.failures).toContain("finding-has-ruleId");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @refarm.dev/quality-contract-v1 test`
Expected: FAIL — `runQualityV1Conformance` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/conformance.ts
import type { QualityChecker, QualityProfile } from "./types.js";

export interface ConformanceResult {
  pass: boolean;
  total: number;
  failed: number;
  failures: string[];
}

export interface ConformanceSample {
  subject: unknown;
  profile: QualityProfile;
  oddSeverityProfile: QualityProfile;
}

/** Assert a checker honours the quality:v1 envelope over a caller-provided sample. */
export async function runQualityV1Conformance(
  checker: QualityChecker,
  sample: ConformanceSample,
): Promise<ConformanceResult> {
  const failures: string[] = [];
  let total = 0;
  const check = (name: string, cond: boolean): void => {
    total++;
    if (!cond) failures.push(name);
  };

  const findings = await checker.check(sample.subject, sample.profile);
  check("findings-is-array", Array.isArray(findings));
  check("findings-nonempty", Array.isArray(findings) && findings.length > 0);
  check("finding-has-ruleId", findings.every((f) => typeof f.ruleId === "string" && f.ruleId.length > 0));
  check("finding-has-severity", findings.every((f) => typeof f.severity === "string" && f.severity.length > 0));

  let threw = false;
  try {
    await checker.check(sample.subject, sample.oddSeverityProfile);
  } catch {
    threw = true;
  }
  check("unknown-severity-no-throw", !threw);

  return { pass: failures.length === 0, total, failed: failures.length, failures };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @refarm.dev/quality-contract-v1 test`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add packages/quality-contract-v1/src/conformance.ts packages/quality-contract-v1/src/conformance.test.ts
git commit -m "feat(quality): quality:v1 envelope conformance runner"
```

---

### Task 5: Public exports + README + build

**Files:**
- Create: `packages/quality-contract-v1/src/index.ts`
- Create: `packages/quality-contract-v1/README.md`

**Interfaces:**
- Produces: the package's public surface (re-exports of types, reference helpers, conformance).

- [ ] **Step 1: Write `src/index.ts`**

```ts
export * from "./types.js";
export {
  resolveProfile,
  severityCounts,
  createReferenceTextChecker,
  runQualityReport,
} from "./reference.js";
export { runQualityV1Conformance } from "./conformance.js";
export type { ConformanceResult, ConformanceSample } from "./conformance.js";
```

- [ ] **Step 2: Write `README.md`**

```markdown
# @refarm.dev/quality-contract-v1

`quality:v1` — declared quality/lint intentions. A neutral rule/finding/profile envelope with a pluggable
per-domain `QualityChecker` (the rule matcher and finding locus are opaque data the checker interprets).
Ships a reference text checker and an envelope conformance runner. See
`specs/features/2026-07-02-quality-contract-v1.md`.
```

- [ ] **Step 3: Build + full test**

Run: `pnpm --filter @refarm.dev/quality-contract-v1 build && pnpm --filter @refarm.dev/quality-contract-v1 test`
Expected: build emits `dist/`; all tests PASS.

- [ ] **Step 4: Verify package scaffold conformance**

Run: `node scripts/validate-packages.mjs`
Expected: the new package conforms (buildable); EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add packages/quality-contract-v1/src/index.ts packages/quality-contract-v1/README.md
git commit -m "feat(quality): public exports + readme; quality-contract-v1 buildable"
```

---

## Self-Review

- **Spec coverage:** §1 types → Task 1; profile composition (`extends`) → Task 2; native reference checker + matcher-is-data → Task 3; conformance (ruleId/severity present, unknown severity no-throw) → Task 4; package surface → Task 5. The WASM checker surface (§2.1) and reference catalogs (text-tells/design-tells rule data) are downstream of this package (separate plans), not part of the contract package itself.
- **Placeholder scan:** none — every step has full code or an exact command.
- **Type consistency:** `resolveQualityProfile`/`countFindings`/`createRegexQualityChecker`/`runQualityCheck` are the public names. The older task text below is retained as planning history, not as an API contract; avoid adding aliases without a real consumer proof.
