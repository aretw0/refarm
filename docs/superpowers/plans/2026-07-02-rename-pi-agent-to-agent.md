# Rename `pi-agent` → `agent` (+ responsibilities glossary) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This is a **codemod-style** rename (staged categories + validation gates), not per-line TDD.

**Goal:** Rename the coding-agent runtime plugin from `pi-agent` to `agent` (`@refarm.dev/agent`), removing the Pi name collision, and add a responsibilities glossary that disambiguates the themed names (refarm / tractor / farmhand / agent).

**Architecture:** The plugin is the *runtime* (`@refarm.dev/agent`); the app `@refarm.dev/farmhand` stays as-is and bundles it. Descriptive name on the primitive, the farm persona on the product. No collision: `packages/agent` and `@refarm.dev/agent` are free.

**Tech Stack:** pnpm workspace, Rust (cargo-component), jco, vitest, WIT.

## Global Constraints

- New package name `@refarm.dev/agent`; directory `packages/agent`; crate name `agent`; WASM artifact `agent.wasm`; jco module `_refarm_agent`.
- **Token-exact replacement only:** replace the literal tokens `pi-agent` and `pi_agent`. Never touch generic `agent`, `runtime-agent`, or `pi`/`Pi` (pi.dev) — those are different things.
- The app `@refarm.dev/farmhand` is NOT renamed; it bundles the agent.
- Do NOT stage or commit files outside this rename; the repo has other active work.
- Homage preserved: the agent README keeps "inspired by Pi" — the credit lives in prose, not the name.
- Scope at plan time: ~255 occurrences across 40+ files (code, tests, CI, docs, diagrams, WIT, plugin.json, Cargo).

## Coordination note

This touches active code in `apps/refarm` and `apps/farmhand` (many tests). Run it as a **single focused pass** when no other agent is mid-edit in those trees, and land it in one or few commits so no reference is left half-renamed. Verify `git status` is otherwise clean before starting.

---

### Task 1: Responsibilities glossary (do this first — it fixes the vocabulary)

**Files:**
- Create: `docs/NAMING_AND_RESPONSIBILITIES.md`

- [ ] **Step 1: Write the glossary**

```markdown
# Naming & Responsibilities

The refarm ecosystem uses a farm metaphor plus descriptive contract names. Because several names rhyme
thematically, here is what each one **is** and is **responsible for** — and what it is **not**.

| Name | Kind | Responsibility | NOT |
|------|------|----------------|-----|
| **refarm** | the ecosystem / platform | The whole sovereign-compute farm: kernel, contracts, apps. | Not a single app or runtime. |
| **tractor** | the platform host / microkernel | Loads and runs WASM plugins with capability enforcement. | Not the agent; it runs plugins. |
| **farmhand** (`@refarm.dev/farmhand`, `apps/farmhand`) | the assistant **app** | Headless daemon: the bridge between the human citizen and the autonomous agents/workflows; bundles plugins, always-on sync. | Not the agent runtime — it *hosts* it. |
| **agent** (`@refarm.dev/agent`, `packages/agent`) | the coding-agent **runtime plugin** | Sovereign AI coding agent: the loop, provider integration, session/task handling. A WASM plugin farmhand bundles. Inspired by Pi, differentiated by CRDT state + WASM Component Model. | Not Pi (pi.dev). Not the app. Was `pi-agent` (renamed to drop the Pi collision). |
| **Pi** (pi.dev) | an **external** engine | The engine agents-lab curates for today; refarm is the second engine. | Not a refarm component — an external reference. |

Rule of thumb: **agent** = the worker runtime (plugin); **farmhand** = the app you run (hosts the agent);
**tractor** = the kernel that loads plugins; **refarm** = all of it. **Pi** is someone else's engine we
learn from.
```

- [ ] **Step 2: Commit**

```bash
git add docs/NAMING_AND_RESPONSIBILITIES.md
git commit -m "docs(naming): responsibilities glossary (refarm/tractor/farmhand/agent/Pi)"
```

---

### Task 2: Rename the package, crate, artifact, WIT, plugin.json

**Files:**
- Rename: `packages/pi-agent/` → `packages/agent/`
- Modify: `packages/agent/package.json` (name, build/jco scripts, `files`)
- Modify: `packages/agent/Cargo.toml` (`name = "agent"`)
- Modify: `packages/agent/plugin.json`, `packages/agent/wit/*.wit`
- Modify: `packages/agent/README.md`

- [ ] **Step 1: Move the directory**

Run: `git mv packages/pi-agent packages/agent`

- [ ] **Step 2: Rename inside package.json**

Set `"name": "@refarm.dev/agent"`. In `build`, `build:wasm`, `build:jco`: replace `pi_agent.wasm` → `agent.wasm`, `_refarm_pi_agent` → `_refarm_agent`. Update `files` (`dist/agent.wasm`). Keep `publishConfig.access="public"` (unheld).

- [ ] **Step 3: Rename the crate + artifact refs**

In `Cargo.toml` set `name = "agent"`. In build scripts the produced artifact path becomes `wasm32-wasip1/release/agent.wasm` (cargo-component derives it from the crate name) copied to `dist/agent.wasm`. Update `check:wit` path in `scripts/ci/check-pi-agent-wit-sync.mjs` reference if the script name is path-coupled (rename that script too if it hardcodes `pi-agent`).

- [ ] **Step 4: Rename tokens in `plugin.json`, `wit/*.wit`, `README.md`**

Replace `pi_agent`/`pi-agent` → `agent`/`agent` in those files. In the README keep the "inspired by Pi" line and the "Future name" line becomes historical (or remove it — the rename is done).

- [ ] **Step 5: Build the WASM to verify the rename is coherent**

Run: `pnpm --filter @refarm.dev/agent build`
Expected: emits `dist/agent.wasm`, `dist/plugin.json`, `dist/jco`. No unresolved `pi_agent` path errors.

- [ ] **Step 6: Commit**

```bash
git add packages/agent scripts/ci
git commit -m "refactor(agent): rename pi-agent package/crate/artifact to agent"
```

---

### Task 3: Codemod workspace imports + dependency references

**Files:**
- Modify: every `package.json` and source file importing `@refarm.dev/pi-agent`.

- [ ] **Step 1: Find the import/dep references**

Run: `rg -l "@refarm.dev/pi-agent" --glob '!node_modules' --glob '!dist'`

- [ ] **Step 2: Replace the specifier**

Replace `@refarm.dev/pi-agent` → `@refarm.dev/agent` in all matched files (imports and `dependencies`/`devDependencies` keys). Then reinstall the workspace: `pnpm install`.

- [ ] **Step 3: Type-check the consumers**

Run: `pnpm -r type-check` (or the repo's equivalent aggregate type-check).
Expected: no "cannot find module @refarm.dev/pi-agent" errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(agent): repoint imports @refarm.dev/pi-agent -> @refarm.dev/agent"
```

---

### Task 4: Codemod remaining `pi-agent` / `pi_agent` tokens in code + tests

**Files:**
- Modify: `apps/refarm/**`, `apps/farmhand/**`, and any remaining source/test files with the literal tokens.

- [ ] **Step 1: Find remaining tokens (excluding docs/diagrams, handled next)**

Run: `rg -l "pi-agent|pi_agent" apps packages --glob '!node_modules' --glob '!dist' --glob '!target'`

- [ ] **Step 2: Replace token-exactly**

Replace `pi_agent` → `agent` and `pi-agent` → `agent` in the matched code/test files. Watch for identifiers that were `piAgent`/`PiAgent` (camel/pascal) — replace those to `agent`/`Agent` too; search separately: `rg -l "piAgent|PiAgent" apps packages --glob '!node_modules'`.

- [ ] **Step 3: Run the affected test suites**

Run: `pnpm --filter @refarm.dev/farmhand test && pnpm --filter apps-refarm test` (use the repo's actual filter names).
Expected: PASS — no references to the old name remain.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(agent): rename pi-agent tokens across apps + tests"
```

---

### Task 5: Docs + diagrams

**Files:**
- Modify: `docs/**` prose references; regenerate `docs/diagrams/*.svg` from their `.mermaid` sources.

- [ ] **Step 1: Replace prose tokens in docs**

Run: `rg -l "pi-agent|pi_agent" docs specs AGENTS.md` then replace `pi-agent`/`pi_agent` → `agent` in prose. Where the sentence distinguished it from Pi, rephrase to "the agent (was pi-agent)" once, then plain "agent".

- [ ] **Step 2: Decide doc-file renames**

Files whose NAME contains the token (e.g. `pi-agent-effort-bridge.md`, `check-pi-agent-wit-sync.mjs`): `git mv` them to the `agent-` name and fix inbound links. Grep for the old filename to catch links: `rg -l "pi-agent-effort-bridge"`.

- [ ] **Step 3: Regenerate diagrams**

Update the `.mermaid` sources' labels, then regenerate the `.svg` via the repo's diagram tool (`mdt update` or the documented command). Do not hand-edit SVGs.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(agent): rename pi-agent references + regenerate diagrams"
```

---

### Task 6: CI workflows

**Files:**
- Modify: `.github/workflows/test.yml`, `.github/workflows/validate-mdt.yml`, any workflow referencing the package/artifact.

- [ ] **Step 1: Replace tokens in workflows**

Run: `rg -l "pi-agent|pi_agent" .github` then replace the package filter names, artifact paths, and script names to the `agent` equivalents.

- [ ] **Step 2: Commit**

```bash
git add .github
git commit -m "ci(agent): repoint pi-agent references in workflows"
```

---

### Task 7: Final validation + publish lane

- [ ] **Step 1: No stragglers**

Run: `rg "pi-agent|pi_agent|piAgent|PiAgent" --glob '!node_modules' --glob '!dist' --glob '!target' --glob '!*.lock'`
Expected: only intentional historical mentions (e.g. a CHANGELOG or the glossary's "was pi-agent"). Everything functional is now `agent`.

- [ ] **Step 2: Package scaffold + build + tests**

Run: `node scripts/validate-packages.mjs && pnpm --filter @refarm.dev/agent build && pnpm -r test` (repo's aggregate test).
Expected: EXIT 0; `@refarm.dev/agent` conforms; suites green.

- [ ] **Step 3: Changeset (agent is unheld + in the publish lane)**

Add a changeset noting the rename so the first publish ships `@refarm.dev/agent` (not `pi-agent`): `pnpm changeset` → select `@refarm.dev/agent`, minor/patch, summary "rename pi-agent → agent".

- [ ] **Step 4: Commit**

```bash
git add .changeset
git commit -m "chore(agent): changeset for the pi-agent -> agent rename"
```

---

## Self-Review

- **Coverage:** package/crate/artifact/WIT/plugin.json (Task 2), imports/deps (Task 3), code/tests incl. camel/pascal (Task 4), docs + diagrams + doc-file renames (Task 5), CI (Task 6), stragglers + build + changeset (Task 7). The glossary (Task 1) fixes the vocabulary first.
- **Token safety:** every replace is on `pi-agent`/`pi_agent`/`piAgent`/`PiAgent` — never generic `agent`, `runtime-agent`, or `Pi`.
- **Consistency:** new names are uniform — `@refarm.dev/agent`, `packages/agent`, crate `agent`, `agent.wasm`, `_refarm_agent`. `farmhand` (app) is untouched throughout.
