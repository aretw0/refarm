# Codemod Registry Contract (Item 9b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A small registry that decides when a transform graduates from manual edits to an agent-operable codemod — metadata + the four named candidates, **before** any codemod runtime or hosted platform.

**Architecture:** A `registry.json` of codemod entries (the schema from the spec) + a JSON validator. The four initial candidates are seeded as `status: "candidate"`. Promoting an entry to `ready`/`implemented` (fixtures + dry-run + rollback) is **per-entry, gated** — done when that specific codemod is actually needed (not in this slice).

**Spec:** `specs/features/2026-06-25-codemod-registry-contract.md`

## Global Constraints

- **No new package, no hosted registry, no MCP** until ≥2 entries are `ready` (spec non-goals). This slice is a JSON file + a validator + the seeded candidates.
- **No broad rewrite without fixtures + dry-run output.** Candidates carry no fixtures yet; only `ready` entries do.
- The non-gated work here is Tasks 1–2. Task 3 is the **per-entry promotion protocol** (runs when a codemod is picked up).

---

### Task 1: Registry file + validator (TDD)

**Files:**
- Create: `codemods/registry.json`
- Create: `codemods/registry.test.mjs`

- [x] **Step 1: Author `codemods/registry.json`** (the four candidates from spec §"Initial candidates")

```json
{
  "version": 1,
  "entries": [
    {
      "id": "npm-scope-doc-sweep",
      "status": "candidate",
      "ownerSurface": "docs",
      "tool": "manual-reviewed",
      "inputs": ["docs that name @aretw0 as a refarm publish scope (ADR-069 §Migration)"],
      "fixtures": [],
      "dryRunCommand": null,
      "verificationGate": "no refarm publish target names @aretw0",
      "rollbackNote": "git revert the doc commit; reviewed replace list avoids blind owner-handle rewrites"
    },
    {
      "id": "credential-provider-rehome",
      "status": "candidate",
      "ownerSurface": "package",
      "tool": "ts-morph",
      "inputs": ["apps/refarm/src/credentials/*.ts import of local types.ts"],
      "fixtures": [],
      "dryRunCommand": null,
      "verificationGate": "credentials providers import the contract from @refarm.dev/silo; existing credential tests pass",
      "rollbackNote": "import boundary change is fixture-testable; revert the import-rewrite commit"
    },
    {
      "id": "ds-token-adoption",
      "status": "candidate",
      "ownerSurface": "consumer repo",
      "tool": "ast-grep",
      "inputs": ["vault-seed/.site/styles/marimo-vault.css locally-defined contract vars"],
      "fixtures": [],
      "dryRunCommand": null,
      "verificationGate": "Lab CSS imports @refarm.dev/ds tokens + verde-jardim; no visual regression",
      "rollbackNote": "CSS custom-property migration; revert the stylesheet commit"
    },
    {
      "id": "vault-seed-manifest-inventory",
      "status": "candidate",
      "ownerSurface": "cross-repo",
      "tool": "generator",
      "inputs": ["generators/vault-seed/manifest.json (item 9a)"],
      "fixtures": [],
      "dryRunCommand": null,
      "verificationGate": "generated vault files map to manifest entries; generated-vault smoke passes",
      "rollbackNote": "generator output is a fresh dir; delete and regenerate"
    }
  ]
}
```

- [x] **Step 2: Write the validator test** — `codemods/registry.test.mjs`

```js
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const reg = JSON.parse(readFileSync(new URL("./registry.json", import.meta.url), "utf8"));
const STATUS = new Set(["candidate", "ready", "implemented", "retired"]);
const TOOL = new Set(["generator", "ast-grep", "ts-morph", "codemod", "manual-reviewed"]);
const REQUIRED = ["id", "status", "ownerSurface", "tool", "inputs", "fixtures", "verificationGate", "rollbackNote"];

test("registry entries are well-formed", () => {
  assert.ok(Array.isArray(reg.entries) && reg.entries.length > 0);
  const ids = new Set();
  for (const e of reg.entries) {
    for (const k of REQUIRED) assert.ok(k in e, `${e.id ?? "?"} missing ${k}`);
    assert.ok(STATUS.has(e.status), `${e.id} bad status`);
    assert.ok(TOOL.has(e.tool), `${e.id} bad tool`);
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
    ids.add(e.id);
  }
});

test("ready entries carry fixtures and a dry-run command", () => {
  for (const e of reg.entries.filter((x) => x.status === "ready" || x.status === "implemented")) {
    assert.ok(e.fixtures.length > 0, `${e.id} ready but no fixtures`);
    assert.ok(e.dryRunCommand, `${e.id} ready but no dryRunCommand`);
  }
});
```

- [x] **Step 3: Run to verify**

Run: `node --test codemods/registry.test.mjs`
Expected: PASS — all four candidates well-formed; the `ready`-entry rule holds vacuously (none are `ready` yet).

- [x] **Step 4: Commit**

```bash
git add codemods/registry.json codemods/registry.test.mjs
git commit -m "feat(codemods): registry contract with seeded candidate entries"
```

---

### Task 2: Document the manual-reviewed line

**Files:**
- Create: `codemods/README.md`

- [x] **Step 1:** Write `codemods/README.md` — the entry schema, the promotion rule (`candidate → ready` needs fixtures + dry-run + rollback + verification), and which candidates stay **manual-reviewed** (`npm-scope-doc-sweep` — a reviewed replace list, not a blind owner-handle rewrite). State the non-goals (no hosted registry / package / MCP until ≥2 `ready`).

- [x] **Step 2: Commit**

```bash
git add codemods/README.md
git commit -m "docs(codemods): registry promotion rule and manual-reviewed line"
```

---

### Task 3: Per-entry promotion protocol (gated — runs at codemod pickup)

> Not part of this slice. Recorded so the first codemod implementation follows a fixed shape.

When a candidate is needed, promote it in one focused change:

1. add `fixtures/` (before/after sample for the transform);
2. implement the transform with the smallest tool that preserves structure (`ts-morph`/`ast-grep`/generator);
3. add the `dryRunCommand` (prints planned files + tool choice, edits nothing) and make it deterministic;
4. set `status: "ready"`, run the registry test (now enforces fixtures + dry-run), then `implemented` after the gate (fixture test + dry-run output + target verification + rollback proof) passes;
5. update `docs/CONVERGENCE_FACTORY_READINESS.md` "Codemod Discipline".

**First implementation candidate** (cheapest, fixture-testable): `credential-provider-rehome` (after item 4c lands) or `ds-token-adoption` (after item 4a).

---

## Non-Goal

No hosted registry, no MCP integration, no new package until ≥2 entries are `ready`. No codemod for ADR decisions or speculative research.

## Self-Review

**Spec coverage:** registry entry schema (§"Registry entry") → Task 1 fields + validator; initial candidates (§) → Task 1 JSON (all four, `candidate`); manual-reviewed documented (§Gate) → Task 2; first-implementation discipline (§Gate, decision) → Task 3 (gated); non-goals → enforced (Tasks 1–2 build only the file + doc). ✓

**Placeholder scan:** candidate `fixtures: []` / `dryRunCommand: null` are **correct for `candidate` status** (the validator only requires them for `ready`/`implemented`), not placeholders. Task 3 is explicitly gated, not stubbed.

**Type consistency:** the `status`/`tool` enums in the validator match the spec's allowed values; entry `id`s match the spec's candidate table and the readiness doc's "next codemod candidates".
