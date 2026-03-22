# Claude Code Automations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 5 Claude Code automations (2 hooks, 2 skills, 2 subagents) identified by the claude-automation-recommender for the refarm monorepo.

**Architecture:** Each automation lives under `.claude/` — hooks are bash scripts under `.claude/hooks/` invoked from `.claude/settings.json` (shared, checked in); skills under `.claude/skills/<name>/SKILL.md`; subagents under `.claude/agents/<name>.md`. The existing `settings.local.json` (personal permissions) is never modified.

**Tech Stack:** Claude Code plugin system (hooks, skills, agents), bash, python3 (already allowed for JSON parsing), TypeScript (monorepo tooling).

---

## File Map

| Status | File | Purpose |
|--------|------|---------|
| Create | `.claude/hooks/dist-guard.sh` | Bash script: block edits to dist/ build/ .turbo/ paths |
| Create | `.claude/hooks/type-check-on-edit.sh` | Bash script: run tsc --noEmit for the affected package |
| Create | `.claude/settings.json` | Shared hooks config referencing the two scripts |
| Create | `.claude/skills/reso/SKILL.md` | `/reso` skill — wraps `node scripts/reso.mjs` |
| Create | `.claude/skills/new-package/SKILL.md` | `/new-package` skill — scaffold a new @refarm.dev package |
| Create | `.claude/agents/contract-conformance-reviewer.md` | Subagent: verify adapter conformance after changes |
| Create | `.claude/agents/changeset-advisor.md` | Subagent: advise whether a changeset entry is needed |

---

## Task 1: Hook Scripts

**Files:**
- Create: `.claude/hooks/dist-guard.sh`
- Create: `.claude/hooks/type-check-on-edit.sh`

### Context

Hooks receive the tool input as JSON via the `CLAUDE_TOOL_INPUT` environment variable. We use `python3 -c` to parse JSON (already allowed in `settings.local.json`). Scripts exit 2 to block, 0 to allow.

The `dist-guard` hook enforces AGENTS.md Rule #1: "NEVER Edit Artifacts." It checks whether `file_path` resolves to a `dist/`, `build/`, or `.turbo/` directory and rejects the edit.

The `type-check-on-edit` hook enforces build-cycle hygiene (AGENTS.md Rule #2): after every `.ts` edit, it detects the owning package and runs `tsc --noEmit` scoped to that package only.

- [ ] **Step 1: Create `.claude/hooks/dist-guard.sh`**

```bash
#!/usr/bin/env bash
# dist-guard.sh — PreToolUse hook: blocks edits to artifact directories (dist/, build/, .turbo/)
# Enforces AGENTS.md Rule #1: Source Sovereignty — NEVER edit artifacts.

FILE_PATH=$(echo "$CLAUDE_TOOL_INPUT" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(d.get('file_path',''))" 2>/dev/null)

if echo "$FILE_PATH" | grep -qE "/(dist|build|\.turbo)/"; then
  echo "" >&2
  echo "🚫 BLOCKED by dist-guard hook" >&2
  echo "   Attempted edit: $FILE_PATH" >&2
  echo "   Artifacts are non-reproducible. Fix the source in src/ and run:" >&2
  echo "   npm run build" >&2
  echo "" >&2
  exit 2
fi

exit 0
```

- [ ] **Step 2: Create `.claude/hooks/type-check-on-edit.sh`**

```bash
#!/usr/bin/env bash
# type-check-on-edit.sh — PostToolUse hook: runs tsc --noEmit for the affected package
# after any .ts file edit. Skips .d.ts files, dist/ files, and files outside packages/.
# Enforces AGENTS.md Rule #2: Build Cycle hygiene.

FILE_PATH=$(echo "$CLAUDE_TOOL_INPUT" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(d.get('file_path',''))" 2>/dev/null)

# Only act on .ts source files (not .d.ts or dist/ artifacts)
if [[ "$FILE_PATH" != *.ts ]] || [[ "$FILE_PATH" == *.d.ts ]] || echo "$FILE_PATH" | grep -q "/dist/"; then
  exit 0
fi

# Extract the package root (e.g. /workspaces/refarm/packages/toolbox)
PKG_ROOT=$(echo "$FILE_PATH" | grep -oP "^.+?/packages/[^/]+")
if [ -z "$PKG_ROOT" ] || [ ! -f "$PKG_ROOT/tsconfig.json" ]; then
  exit 0
fi

PKG_NAME=$(basename "$PKG_ROOT")
echo "🔍 Type-checking @refarm.dev/$PKG_NAME ..."
cd /workspaces/refarm && npx tsc --noEmit -p "$PKG_ROOT/tsconfig.json" 2>&1 | tail -30

exit 0
```

- [ ] **Step 3: Make scripts executable**

```bash
chmod +x .claude/hooks/dist-guard.sh .claude/hooks/type-check-on-edit.sh
```

- [ ] **Step 4: Commit hook scripts**

```bash
git add .claude/hooks/
git commit -m "chore(claude): add dist-guard and type-check-on-edit hook scripts"
```

---

## Task 2: Shared Hooks Config

**Files:**
- Create: `.claude/settings.json`

### Context

`.claude/settings.json` is the **project-level** Claude Code settings file — it is committed to the repo and applies to all contributors. The `matcher` field filters which tool names trigger the hook. Scripts are referenced by path relative to the workspace root.

- [ ] **Step 1: Create `.claude/settings.json`**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/dist-guard.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/type-check-on-edit.sh"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Smoke-test dist-guard**

Ask Claude to edit any file under `packages/storage-sqlite/dist/`. Claude should be blocked immediately with the `🚫 BLOCKED` message and the suggested fix.

- [ ] **Step 3: Smoke-test type-check**

Ask Claude to edit `packages/toolbox/src/index.ts` (or any TS-Strict package source file). After the edit, the hook should print `🔍 Type-checking @refarm.dev/toolbox ...` followed by tsc output.

- [ ] **Step 4: Commit**

```bash
git add .claude/settings.json
git commit -m "chore(claude): add shared hooks config (dist-guard + type-check-on-edit)"
```

---

## Task 3: `/reso` Skill

**Files:**
- Create: `.claude/skills/reso/SKILL.md`

### Context

`node scripts/reso.mjs <src|dist|status>` is the canonical monorepo navigation command (AGENTS.md Rule #3). The skill wraps this with interactive guidance so neither the user nor Claude needs to remember the exact invocation.

- [ ] **Step 1: Create `.claude/skills/reso/SKILL.md`**

```markdown
---
name: reso
description: Check or toggle the monorepo resolution mode between local src (dev) and published dist (production validation). Use before starting dev work or before running release validation.
disable-model-invocation: true
---

Run the following command and show the output verbatim:

    node scripts/reso.mjs status

Then ask the user:
> "Which resolution mode do you want?
> - **src** — local development (edits in `src/` are immediately visible)
> - **dist** — production validation (uses built `dist/` artifacts, as npm consumers see)
> - **keep** — leave as is"

Based on their answer:
- **src**: run `node scripts/reso.mjs src`
- **dist**: run `node scripts/reso.mjs dist`
- **keep**: do nothing

After switching, run `node scripts/reso.mjs status` again and confirm the new state.

If the user switched to **dist**, remind them:
> "Remember: run `npm run build` in any package you changed before tests will reflect your edits."
```

- [ ] **Step 2: Verify**

Type `/reso` in Claude Code. The skill should invoke `reso.mjs status` and show the current resolution state for all packages.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/reso/
git commit -m "chore(claude): add /reso skill for resolution mode switching"
```

---

## Task 4: `/new-package` Skill

**Files:**
- Create: `.claude/skills/new-package/SKILL.md`

### Context

Two package types exist in this monorepo (AGENTS.md Rule #4 — Hybrid Awareness):
- **TS-Strict**: `tsconfig.build.json` present, source is `.ts`, output to `dist/`.
- **JS-Atomic**: no build config, source is `.js`.

A skill that guides the scaffolding eliminates structural divergence. The canonical TS-Strict reference is `packages/toolbox/`.

- [ ] **Step 1: Create `.claude/skills/new-package/SKILL.md`**

```markdown
---
name: new-package
description: Scaffold a new @refarm.dev package in the monorepo with correct conventions (TS-Strict or JS-Atomic). Asks for package name, type, and contracts, then creates all required files.
disable-model-invocation: true
---

Ask the user:

1. **Package name** (without `@refarm.dev/` prefix, e.g. `my-feature`)?
2. **Package type**:
   - **TS-Strict** — TypeScript with `tsconfig.build.json`, output to `dist/` (default for most packages)
   - **JS-Atomic** — plain `.js`, no build step (for config-only or tooling packages)
3. **Contracts** (optional): does this package implement `storage-contract-v1`, `sync-contract-v1`, or `identity-contract-v1`? If yes, which ones?

Then read `packages/toolbox/package.json` as the canonical structural reference and scaffold:

**TS-Strict packages — create these files:**

`packages/<name>/package.json`:
- `"name": "@refarm.dev/<name>"`
- `"version": "0.1.0"`
- `"type": "module"`
- `"main": "./dist/index.js"`, `"types": "./dist/index.d.ts"`
- scripts: `build`, `type-check`, `test` (same pattern as toolbox)

`packages/<name>/tsconfig.json`:
- `{ "extends": "../../tsconfig.json", "include": ["src"] }`

`packages/<name>/tsconfig.build.json`:
- extends `./tsconfig.json`, sets `outDir: "./dist"`, `rootDir: "./src"`, excludes test files

`packages/<name>/src/index.ts`:
- Empty barrel: `// TODO: implement @refarm.dev/<name>\nexport {};`

`packages/<name>/src/index.test.ts`:
- Minimal vitest smoke test (import describe/it from vitest, one passing test)

**JS-Atomic packages — create these files:**

`packages/<name>/package.json`:
- `"name": "@refarm.dev/<name>"`, `"type": "module"`, `"main": "./index.js"`, no build script

`packages/<name>/index.js`:
- `// @refarm.dev/<name>\nexport {};`

**After creating files:**

1. Remind: add the package alias to `vitest.config.ts` if it will be consumed in tests.
2. If contracts were specified: read `packages/<contract>/README.md` to understand the required interface.
3. Run `npm install` to link the new workspace package.

Source Sovereignty reminder: all edits go in `src/`. Run `npm run build` before other packages can consume types.
```

- [ ] **Step 2: Verify**

Type `/new-package` and confirm it asks all three setup questions.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/new-package/
git commit -m "chore(claude): add /new-package skill for package scaffolding"
```

---

## Task 5: `contract-conformance-reviewer` Subagent

**Files:**
- Create: `.claude/agents/contract-conformance-reviewer.md`

### Context

`npm run test:capabilities` runs conformance suites for all adapter packages against their contracts. This subagent runs that command and interprets failures into actionable messages.

- [ ] **Step 1: Create `.claude/agents/contract-conformance-reviewer.md`**

```markdown
---
name: contract-conformance-reviewer
description: Use after editing any adapter package (storage-sqlite, storage-memory, storage-rest, identity-nostr, sync-crdt, sync-loro) to verify contract conformance is preserved. Runs npm run test:capabilities and reports failures with remediation guidance.
---

You are a contract conformance specialist for the Refarm monorepo.

## Your job

Verify that recently edited adapter packages still satisfy their contracts. Report clearly. Suggest fixes. Do NOT edit any files.

## Steps

1. Run the conformance suite:
   ```
   npm run test:capabilities
   ```

2. For each test suite in the output, report:
   - ✅ PASS — `@refarm.dev/<adapter>` conforms to `<contract>`
   - ❌ FAIL — `@refarm.dev/<adapter>` violates `<contract>` at test: `<test name>`

3. For each failure, provide:
   - Which adapter broke: `packages/<adapter>/src/`
   - Which contract was violated: `packages/<contract-name>/src/`
   - What the test expects (summarize from the test name/output)
   - Suggested fix: "Read `packages/<contract-name>/src/` for the required interface signature, then fix `packages/<adapter>/src/`."

4. If all pass: "✅ All contract conformance tests pass. All adapters are compliant."

## Contracts in this monorepo

- `storage-contract-v1` — implemented by: `storage-sqlite`, `storage-memory`, `storage-rest`
- `sync-contract-v1` — implemented by: `sync-crdt`, `sync-loro`
- `identity-contract-v1` — implemented by: `identity-nostr`

## Important

- Do NOT confuse conformance failures with unrelated unit test failures.
- Do NOT edit any source files. This agent is read-and-report only.
- The source of truth for each contract's required interface is `packages/<contract-name>/src/`.
```

- [ ] **Step 2: Smoke-test**

Ask Claude: "Run the contract-conformance-reviewer after my last storage-sqlite edit." Confirm it runs `npm run test:capabilities` and interprets the output.

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/contract-conformance-reviewer.md
git commit -m "chore(claude): add contract-conformance-reviewer subagent"
```

---

## Task 6: `changeset-advisor` Subagent

**Files:**
- Create: `.claude/agents/changeset-advisor.md`

### Context

The `validate-changeset.yml` CI workflow enforces that PRs touching public packages include a changeset entry. The subagent prevents last-minute CI failures by checking the diff against `origin/main` before the user commits.

- [ ] **Step 1: Create `.claude/agents/changeset-advisor.md`**

```markdown
---
name: changeset-advisor
description: Use before committing or opening a PR to check whether the current changes require a changeset entry. Inspects changed files and recommends the correct semver bump (patch/minor/major).
---

You are a changeset advisor for the Refarm monorepo.

## Your job

Determine if the current branch changes require a changeset entry. Never create the changeset yourself — changesets require interactive prompts that only the user can complete.

## Steps

1. Fetch main and get changed files:
   ```
   git fetch origin main --quiet
   git diff --name-only origin/main...HEAD
   ```

2. Check for existing changeset entries:
   ```
   git diff --name-only origin/main...HEAD | grep "^\.changeset/"
   ```

3. From the changed files, identify public packages:
   - Include: `packages/*/src/**` paths
   - Exclude: `validations/`, `apps/`, `scripts/`, `docs/`, `.github/`, `specs/`
   - For each candidate, check `packages/<name>/package.json` — if `"private": true`, skip it

4. Apply the bump decision matrix:

   | What changed | Bump |
   |---|---|
   | Bug fix, internal refactor, test update | `patch` |
   | New exported function, type, or capability added | `minor` |
   | Removed export, renamed export, breaking interface change | `major` |

5. Report:

   **Changeset already present:**
   "✅ Changeset found in `.changeset/`. No action needed."

   **Changeset missing, public packages changed:**
   "⚠️ No changeset found. Public packages with changes:
   - `@refarm.dev/<pkg>` — suggested bump: `<level>` (reason: <what changed>)

   Run `npx changeset` to create one. Select the packages above and choose the bump level."

   **Only private/internal files changed:**
   "ℹ️ No public package changes detected. Changeset not required."

## Important

- The `.changeset/config.json` baseBranch is `main`.
- `apps/` and `validations/` changes never require changesets.
- Do NOT create the changeset file yourself.
```

- [ ] **Step 2: Smoke-test**

Ask Claude: "Do I need a changeset for my current changes?" Confirm it runs git diff and reports correctly.

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/changeset-advisor.md
git commit -m "chore(claude): add changeset-advisor subagent"
```

---

## Task 7: GitHub MCP — Team Setup (Optional)

This cannot be automated — it requires a personal GitHub token.

**User action:**

```bash
# 1. Create a PAT at https://github.com/settings/tokens
#    Scopes: repo, read:org, workflow

# 2. Export it:
export GITHUB_TOKEN=ghp_your_token_here

# 3. Install:
claude mcp add github -- npx -y @modelcontextprotocol/server-github
```

**To share with the team**, create `.mcp.json` at the repo root:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

Commit `.mcp.json`. Each contributor sets `GITHUB_TOKEN` in their environment and gets the GitHub MCP automatically.

---

## Final Verification Checklist

- [ ] `cat .claude/settings.json` — PreToolUse and PostToolUse hooks present
- [ ] Edit a `dist/` file — Claude blocked with `🚫 BLOCKED by dist-guard hook`
- [ ] Edit a `.ts` source file — hook prints `🔍 Type-checking @refarm.dev/<pkg> ...`
- [ ] `/reso` — shows resolution status and asks for mode
- [ ] `/new-package` — asks name, type, and contracts
- [ ] "Run contract-conformance-reviewer" — executes `npm run test:capabilities`
- [ ] "Do I need a changeset?" — inspects diff and advises correctly
