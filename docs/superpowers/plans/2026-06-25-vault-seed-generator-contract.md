# Generator-First Vault-Seed Distribution (Item 9a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Nature:** this is a **prototype** (spec status: "ready for planning/prototype"), and it is
> **manifest-first** — the contract is `manifest.json`, not bite-sized TDD code. Task 1 is fully
> concrete (the classification is derived from `vault-seed/.github/workflows/initialize.yml`); the
> generator (Task 2+) is prototype code that iterates against the real `vault-seed` source.

**Goal:** A manifest-first `refarm gen vault-seed` path that materializes a smoke-tested vault from `vault-seed` source, respecting the template-dev boundary, with a round-trip inventory.

**Architecture:** `manifest.json` classifies every source path (`payload` / `dev-only` / `transform` / `derived` / `local-state`). The generator reads the manifest + a `vault-seed` checkout (via a pinned local path or the librarian) and emits a generated vault + an inventory report. The boundary is the existing `initialize.yml` (`files_to_rename`, `files_to_remove`, the `sed`/config edits).

**Spec:** `specs/features/2026-06-25-vault-seed-generator-contract.md`

## Global Constraints

- **Source of truth for the boundary:** `vault-seed/.github/workflows/initialize.yml`. The manifest must stay consistent with it — a test cross-checks them.
- **Prototype scope:** a minimal valid vault (PARA + onboarding, the packages/workflows needed for local validation, site/Lab config for smoke). **No** secrets, caches, or `dist`.
- **Idempotent transforms.** Generating twice yields identical output.
- **No bespoke fork:** the generator consumes `vault-seed` as source; it does not re-author the template.

---

### Task 1: The manifest (concrete, from `initialize.yml`)

**Files:**
- Create: `generators/vault-seed/manifest.json`
- Create: `generators/vault-seed/manifest.test.mjs` (schema + boundary cross-check)

- [x] **Step 1: Author `manifest.json`** — entries derived directly from `initialize.yml`

```json
{
  "version": 1,
  "source": "vault-seed",
  "renames": [
    { "source": "README.template.md", "target": "README.md", "class": "transform", "transforms": ["rename"] },
    { "source": "CONTRIBUTING.template.md", "target": "CONTRIBUTING.md", "class": "transform", "transforms": ["rename"] },
    { "source": "AGENTS.template.md", "target": "AGENTS.md", "class": "transform", "transforms": ["rename"] },
    { "source": "package.template.json", "target": "package.json", "class": "transform", "transforms": ["rename"] },
    { "source": "pnpm-lock.template.yaml", "target": "pnpm-lock.yaml", "class": "transform", "transforms": ["rename"] }
  ],
  "transforms": [
    { "source": "00 - Entrada/Bem-vindo ao seu vault.md", "target": "00 - Entrada/Bem-vindo ao seu vault.md", "class": "transform", "transforms": ["status-draft-to-published"], "validation": "scripts/smoke_user_e2e.mjs" },
    { "source": "vault.config.json", "target": "vault.config.json", "class": "transform", "transforms": ["drop-kudos", "set-license-holder"], "validation": "scripts/smoke_user_e2e.mjs" }
  ],
  "devOnly": [
    "docs", ".templates", "ROADMAP.md",
    "AGENTS.template.md", "README.template.md", "CONTRIBUTING.template.md",
    "packages/cli", "packages/dgk-channels", "packages/dgk-runner", "packages/dgk-skills",
    ".changeset", "mdt.toml", "CNAME",
    ".github/workflows/template-ci.yml", ".github/workflows/prepare-release-pr.yml",
    ".github/workflows/release.yml", ".github/workflows/security-audit.yml",
    ".github/workflows/sync-develop-with-main.yml", ".github/workflows/validate-mdt.yml",
    ".github/workflows/publish-packages.yml", ".github/workflows/publish-lab-runtime.yml",
    ".github/workflows/refresh-lab-data.yml",
    "scripts/audience_boundary.test.js", "scripts/deploy_site_workflow.test.js",
    "scripts/mermaid_render_contract.test.js", "scripts/mermaid_toggle.test.js",
    "scripts/release_package_smoke.test.js", "scripts/release_package_smoke.mjs",
    "scripts/release_version_contract.test.mjs", "scripts/lab_runtime_version_contract.test.mjs",
    "scripts/sync_lockfile_template.mjs", "scripts/smoke_template.js",
    "scripts/smoke_initialize_reset.mjs", "scripts/smoke_user_vault.mjs", "scripts/smoke_user_e2e.mjs"
  ],
  "payloadGlobs": ["**"],
  "derivedOrLocalState": [".dgk", "dist", "node_modules", ".astro", ".sandbox", ".site/dist"]
}
```

> `payloadGlobs: ["**"]` means "everything not listed in `renames`/`transforms`/`devOnly`/
> `derivedOrLocalState` is `payload`". The remaining payload includes the PARA folders,
> `packages/{dgk-cli,dgk-astro-plugins,lab-runtime,astro-plugins}`, `.site/`, `astro.config.mjs`.
>
> The `vault.config.json` transform (`initialize.yml` step "Publish user welcome note and clear
> vault-seed kudos", lines 25–39) does two edits: **`drop-kudos`** (`delete cfg.kudos`) and
> **`set-license-holder`** (`cfg.license.holder = <repo owner>`, `holderUrl = https://github.com/<owner>`).
> The owner comes from `GITHUB_REPOSITORY`; the generator takes it as a `--owner` input.

- [x] **Step 2: Write the boundary cross-check test** — `manifest.test.mjs`

```js
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const initYml = readFileSync(new URL("../../../vault-seed/.github/workflows/initialize.yml", import.meta.url), "utf8");

test("every initialize.yml files_to_remove entry is classified dev-only", () => {
  const removeLine = /files_to_remove:\s*"([^"]+)"/.exec(initYml);
  assert.ok(removeLine, "files_to_remove not found");
  const removed = removeLine[1].split(/\s+/).filter(Boolean);
  for (const path of removed) {
    assert.ok(manifest.devOnly.includes(path), `missing dev-only classification: ${path}`);
  }
});

test("every rename in initialize.yml is a transform entry", () => {
  const renameLine = /files_to_rename:\s*"([^"]+)"/.exec(initYml);
  const pairs = renameLine[1].split(/\s+/).filter(Boolean).map((p) => p.split(":"));
  for (const [src, target] of pairs) {
    assert.ok(
      manifest.renames.some((r) => r.source === src && r.target === target),
      `missing rename: ${src} -> ${target}`,
    );
  }
});
```

- [x] **Step 3: Run the cross-check**

Run: `node --test generators/vault-seed/manifest.test.mjs`
Expected: PASS — the manifest matches `initialize.yml`'s boundary. (Adjust the relative path to `vault-seed` if the checkouts are not siblings; the test documents the dependency on a `vault-seed` source.)

Executed with a real checkout:

```bash
VAULT_SEED_SOURCE_DIR=/home/vscode/.cache/checkouts/github.com/aretw0/vault-seed node --test generators/vault-seed/manifest.test.mjs
```

Without `VAULT_SEED_SOURCE_DIR`, the schema test still runs and the cross-repo checks are explicitly skipped so repo-local validation does not pretend a missing consumer checkout was inspected.

- [x] **Step 4: Commit**

```bash
git add generators/vault-seed/manifest.json generators/vault-seed/manifest.test.mjs
git commit -m "feat(gen-vault-seed): manifest classifying the vault-seed template boundary"
```

---

### Task 2: Generator that applies the manifest

**Files:**
- Create: `generators/vault-seed/generate.mjs`
- Create: `generators/vault-seed/generate.test.mjs`

**Interfaces:** `generateVault({ manifest, sourceDir, outDir }): { written: string[], skipped: string[], inventory: InventoryEntry[] }`.

- [x] **Step 1: Write the failing test** against a tiny fixture source tree (created in the test) — assert payload copied, dev-only skipped, renames applied. (Mirror the manifest classes; use a temp `sourceDir` with `README.template.md`, `docs/x.md`, `00 - Entrada/note.md`.)

- [x] **Step 2: Implement `generate.mjs`** — walk `sourceDir`; for each path: skip `devOnly`/`derivedOrLocalState`; apply `renames` (copy to target); apply `transforms` (rename + content edit hooks); copy the rest as `payload`. Record an inventory entry `{ source, target, class, transforms, validation }` per output file.

- [x] **Step 3: Run to verify it passes** — `node --test generators/vault-seed/generate.test.mjs`.

- [x] **Step 4: Commit** — `feat(gen-vault-seed): manifest-driven generator with inventory`.

---

### Task 3: Transform hooks (idempotent)

- [x] **Step 1:** Implement the transforms, each keyed by ID:
  - `rename` (Task 2) — copy `source` → `target`.
  - `status-draft-to-published` — `(content) => content.replace(/^status: draft$/m, "status: published")` (the welcome note).
  - `drop-kudos` — on `vault.config.json`: `delete cfg.kudos`.
  - `set-license-holder` — on `vault.config.json`: `cfg.license = { ...cfg.license, holder: owner, holderUrl: "https://github.com/" + owner }` (owner from `--owner`).
- [x] **Step 2:** Idempotency test — each transform run twice equals once; generating the whole vault twice yields byte-identical output (given a fixed `--owner`).
- [x] **Step 3: Commit** — `feat(gen-vault-seed): idempotent content transforms`.

---

### Task 4: Smoke harness against the generated vault

- [x] **Step 1:** Generate a vault into a temp dir from a pinned `vault-seed` source.
- [x] **Step 2:** Run the `vault-seed` generated-vault smoke against the output. The existing
  `vault-seed/scripts/smoke_user_e2e.mjs` already simulates init then runs `notebooks:etl:demo` +
  `site:build` and checks `dist/index.html`; the prototype gate is the lighter
  `smoke_user_vault.mjs` if e2e is too slow.
- [x] **Step 3:** Assert no `devOnly` path exists in the generated output.
- [x] **Step 4: Commit** — `test(gen-vault-seed): smoke the generated vault`.

Executed lightweight generated-vault smoke:

```bash
VAULT_SEED_SOURCE_DIR=/home/vscode/.cache/checkouts/github.com/aretw0/vault-seed node --test generators/vault-seed/*.test.mjs
```

The smoke harness generates a temp vault from the cached checkout, validates renames, absence of
`devOnly`/derived/local-state paths, welcome/config transforms, package-template preference, and
that untracked cache files such as `vendor/` do not leak.

---

### Task 5: Inventory report + codemod decision

- [x] **Step 1:** Emit `inventory.json` mapping every generated file → `{ source, transforms, validation }` (round-trip contract, spec decision 5).
- [x] **Step 2:** Record which transforms warrant a codemod (`ast-grep`/`ts-morph`) vs a direct generator action (per `docs/CONVERGENCE_FACTORY_READINESS.md` "Codemod Discipline"): repository identity + package metadata = codemod candidates; Markdown prose edits stay direct unless mechanical/repeated.
- [x] **Step 3:** Add a changeset only if a publishable package changed (the generator under `generators/` may be repo-internal tooling — confirm with `validate-packages`).
- [x] **Step 4: Commit** — `feat(gen-vault-seed): inventory report + codemod classification`.

Executed lightweight gates:

```bash
node --test generators/vault-seed/generate.test.mjs
node --test generators/vault-seed/smoke.test.mjs
VAULT_SEED_SOURCE_DIR=/home/vscode/.cache/checkouts/github.com/aretw0/vault-seed node --test generators/vault-seed/*.test.mjs
```

No changeset was added: this slice changes repo-internal generator/docs surfaces only, not a
publishable package.

---

## Non-Goal

Do not migrate existing user vaults (separate migration contract). Do not replace `vault-seed` as the canonical dogfood repo. Do not publish a generated vault.

## Self-Review

**Spec coverage:** manifest-first (decision 1) → Task 1 (concrete, boundary-cross-checked); no bespoke fork (decision 2) → generator consumes source, Task 2; generated vault passes smoke (decision 3) → Task 4; codemods only for repeatable (decision 4) → Task 5; round-trip inventory (decision 5) → Task 5. ✓

**Placeholder scan:** none. The full boundary is resolved — `devOnly`/`renames` are verbatim from `initialize.yml`'s `files_to_remove`/`files_to_rename`, and the `vault.config.json` transforms (`drop-kudos`, `set-license-holder`) are read from the inline node script (lines 25–39). The only runtime input is `--owner`.

**Type/consistency:** `devOnly` entries match `initialize.yml` `files_to_remove` verbatim (Task 1 test enforces this); `renames` match `files_to_rename`; the generator's classes (`payload`/`dev-only`/`transform`/`derived`) match the manifest fields.
