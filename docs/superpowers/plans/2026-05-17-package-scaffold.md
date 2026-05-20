# Package Scaffold Generator & Conformance Linter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `pnpm turbo gen package` to scaffold new packages correctly and a CI linter that blocks PRs with non-conformant package structures.

**Architecture:** `turbo/generators/config.ts` registers a Plop generator with per-type Handlebars templates; `scripts/validate-packages.mjs` classifies every `packages/*` directory and validates it against type-specific rules; a new `validate-scaffold` CI job runs the linter on every PR.

**Tech Stack:** `@turbo/gen` (Plop.js wrapper), Node.js ESM, Handlebars `.hbs` templates, GitHub Actions.

**Codemod research tie-in:** This plan is the first low-risk place to practice the `migration pack` discipline described in [`docs/research/codemod-strategic-assessment.md`](../../research/codemod-strategic-assessment.md). Do not introduce a separate package system here. Treat the scaffold/linter work as a proto migration profile for Refarm plugin packages: deterministic rules, fixtureable outputs, dry-run/evidence, scoped validation, and agent-operable instructions.

---

## Key files to study before implementing

- `packages/tsconfig/buildable.json` — the preset `buildable` tsconfigs extend
- `packages/tsconfig/build.json` — the preset `tsconfig.build.json` files extend
- `packages/effort-contract-v1/` — canonical `buildable` package (tsconfig + package.json)
- `packages/event-contract-v1/` — canonical `source-only` package
- `packages/heartwood/` — canonical `wasm-component` package
- `packages/ds/` — canonical `ui-library` package
- `packages/toolbox/` — canonical `js-tool` package
- `packages/tsconfig/` — canonical `config-pkg`
- `tsconfig.json` (repo root) — the `paths` object the generator must update
- `.github/workflows/test.yml:238` — where the new CI job sits alongside `quality`

---

## File Structure

```
turbo/
  generators/
    config.ts                          ← Plop entry point, registers "package" generator
    templates/
      buildable/
        package.json.hbs
        tsconfig.json.hbs
        tsconfig.build.json.hbs
        src/index.ts.hbs
        src/index.test.ts.hbs
      source-only/
        package.json.hbs
        tsconfig.json.hbs
        src/index.ts.hbs
      wasm-component/
        package.json.hbs
        Cargo.toml.hbs
        src/lib.rs.hbs
        wit/world.wit.hbs
      ui-library/
        package.json.hbs
        tsconfig.json.hbs
        tsconfig.build.json.hbs
        src/index.ts.hbs
        src/index.test.ts.hbs
      js-tool/
        package.json.hbs
        src/cli.mjs.hbs
      config-pkg/
        package.json.hbs

scripts/
  validate-packages.mjs               ← CI linter (pure Node ESM, no dependencies)

.github/workflows/test.yml            ← add validate-scaffold job
packages/sower/tsconfig.json          ← migrate to buildable preset
packages/sower/tsconfig.build.json    ← migrate to build preset
packages/barn/tsconfig.json           ← migrate to buildable preset
packages/barn/tsconfig.build.json     ← migrate to build preset
packages/tractor-ts/package.json      ← add scaffold.exempt field
```

---

## Task 1: Install @turbo/gen and wire config.ts

**Files:**
- Modify: `package.json` (root devDependencies)
- Create: `turbo/generators/config.ts`

- [ ] **Step 1: Install @turbo/gen**

```bash
pnpm add -D -w @turbo/gen
```

Expected: `@turbo/gen` appears in root `package.json` devDependencies.

- [ ] **Step 2: Create `turbo/generators/config.ts`**

```typescript
import type { PlopTypes } from "@turbo/gen";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  plop.setGenerator("package", {
    description: "Scaffold a new @refarm.dev package",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "Package name (without scope, e.g. my-contract-v1):",
        validate: (v: string) =>
          /^[a-z][a-z0-9-]*$/.test(v) || "Use lowercase kebab-case",
      },
      {
        type: "list",
        name: "type",
        message: "Package type:",
        choices: [
          "buildable",
          "source-only",
          "wasm-component",
          "ui-library",
          "js-tool",
          "config-pkg",
        ],
      },
      {
        type: "input",
        name: "description",
        message: "Description:",
      },
      {
        type: "confirm",
        name: "private",
        message: "Private?",
        default: true,
      },
    ],
    actions(data) {
      if (!data) return [];
      const { name, type, description, private: isPrivate } = data;
      const dest = `packages/{{name}}`;
      const templateDir = `turbo/generators/templates/${type}`;

      // Derive SCREAMING_SNAKE_CASE constant name: my-contract-v1 → MY_CONTRACT_V1
      data.constantName = name.replace(/-/g, "_").toUpperCase();
      data.privateStr = isPrivate ? "true" : "false";

      const actions: PlopTypes.ActionType[] = [
        // Add all template files for the chosen type
        {
          type: "addMany",
          destination: dest,
          templateFiles: `${templateDir}/**`,
          base: templateDir,
          globOptions: { dot: true },
        },
      ];

      // For buildable and ui-library: patch root tsconfig.json paths
      if (type === "buildable" || type === "source-only" || type === "ui-library") {
        actions.push({
          type: "modify",
          path: "tsconfig.json",
          transform(content: string) {
            const tsconfig = JSON.parse(content);
            const paths = tsconfig.compilerOptions.paths ?? {};
            paths[`@refarm.dev/${name}`] = [`./packages/${name}/src`];
            if (type === "buildable" || type === "ui-library") {
              paths[`@refarm.dev/${name}`] = [`./packages/${name}/src`];
            }
            tsconfig.compilerOptions.paths = paths;
            return JSON.stringify(tsconfig, null, 2) + "\n";
          },
        });
      }

      return actions;
    },
  });
}
```

- [ ] **Step 3: Verify turbo gen loads**

```bash
pnpm turbo gen package --help
```

Expected output includes: `Scaffold a new @refarm.dev package`

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml turbo/generators/config.ts
git commit -m "feat(scaffold): install @turbo/gen and wire package generator entry point"
```

---

## Task 2: buildable templates

**Files:**
- Create: `turbo/generators/templates/buildable/package.json.hbs`
- Create: `turbo/generators/templates/buildable/tsconfig.json.hbs`
- Create: `turbo/generators/templates/buildable/tsconfig.build.json.hbs`
- Create: `turbo/generators/templates/buildable/src/index.ts.hbs`
- Create: `turbo/generators/templates/buildable/src/index.test.ts.hbs`

- [ ] **Step 1: Create `package.json.hbs`**

```
{
  "name": "@refarm.dev/{{name}}",
  "version": "0.1.0",
  "private": {{privateStr}},
  "description": "{{description}}",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "dev": "tsc --project tsconfig.build.json --watch",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "@refarm.dev/tsconfig": "workspace:*",
    "typescript": "^6.0.3",
    "vitest": "^4.1.4"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json.hbs`**

```
{
	"extends": ["../../tsconfig.json", "@refarm.dev/tsconfig/buildable.json"],
	"compilerOptions": {
		"outDir": "dist",
		"baseUrl": "../.."
	},
	"include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `tsconfig.build.json.hbs`**

```
{
	"extends": ["./tsconfig.json", "@refarm.dev/tsconfig/build.json"],
	"compilerOptions": {
		"rootDir": "src"
	}
}
```

- [ ] **Step 4: Create `src/index.ts.hbs`**

```
export const {{constantName}}_CAPABILITY = "{{name}}:v1" as const;
```

- [ ] **Step 5: Create `src/index.test.ts.hbs`**

```
import { describe, it, expect } from "vitest";
import { {{constantName}}_CAPABILITY } from "./index.js";

describe("{{name}}", () => {
  it("exports capability marker", () => {
    expect({{constantName}}_CAPABILITY).toBe("{{name}}:v1");
  });
});
```

- [ ] **Step 6: Run the generator end-to-end**

```bash
pnpm turbo gen package
# Enter: test-pkg-v1 / buildable / Test package / y
```

Expected: `packages/test-pkg-v1/` created with all 5 files. Root `tsconfig.json` now has `"@refarm.dev/test-pkg-v1": ["./packages/test-pkg-v1/src"]` in `paths`.

- [ ] **Step 7: Verify the generated package builds**

```bash
pnpm --filter=@refarm.dev/test-pkg-v1 run build
```

Expected: exits 0, `packages/test-pkg-v1/dist/index.js` exists.

- [ ] **Step 8: Verify tests pass**

```bash
pnpm --filter=@refarm.dev/test-pkg-v1 run test
```

Expected: 1 test passes.

- [ ] **Step 9: Delete test package and commit templates**

```bash
rm -rf packages/test-pkg-v1
# Also remove the paths entry added to tsconfig.json by the generator for test-pkg-v1
git add turbo/generators/templates/buildable/
git commit -m "feat(scaffold): buildable package templates"
```

---

## Task 3: Remaining templates (source-only, wasm-component, ui-library, js-tool, config-pkg)

**Files:**
- Create: all template files under `turbo/generators/templates/{source-only,wasm-component,ui-library,js-tool,config-pkg}/`

- [ ] **Step 1: Create `source-only/package.json.hbs`**

```
{
  "name": "@refarm.dev/{{name}}",
  "version": "0.1.0",
  "private": {{privateStr}},
  "description": "{{description}}",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "@refarm.dev/tsconfig": "workspace:*",
    "typescript": "^6.0.3",
    "vitest": "^4.1.4"
  }
}
```

- [ ] **Step 2: Create `source-only/tsconfig.json.hbs`**

```
{
	"extends": "@refarm.dev/tsconfig/node.json",
	"compilerOptions": {
		"baseUrl": "../.."
	},
	"include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `source-only/src/index.ts.hbs`**

```
export const {{constantName}}_CAPABILITY = "{{name}}:v1" as const;
```

- [ ] **Step 4: Create `wasm-component/package.json.hbs`**

```
{
  "name": "@refarm.dev/{{name}}",
  "version": "0.1.0",
  "private": {{privateStr}},
  "description": "{{description}}",
  "type": "module",
  "main": "./pkg/{{name}}.js",
  "types": "./pkg/{{name}}.js",
  "scripts": {
    "build:wasm": "RUSTUP_TOOLCHAIN=stable cargo component build --target wasm32-wasip1 --release && mkdir -p dist && cp $(node ../../scripts/ci/cargo-artifact-path.mjs wasm32-wasip1/release/refarm_{{snakeCase name}}.wasm) dist/refarm_{{snakeCase name}}.wasm",
    "build:transpile": "jco transpile dist/refarm_{{snakeCase name}}.wasm -o pkg --name {{name}}",
    "build": "npm run build:wasm && npm run build:transpile",
    "test": "RUSTUP_TOOLCHAIN=stable cargo test -- --test-threads=1"
  }
}
```

- [ ] **Step 5: Create `wasm-component/Cargo.toml.hbs`**

```
[package]
name = "refarm-{{name}}"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wit-bindgen = "0.36"
```

- [ ] **Step 6: Create `wasm-component/src/lib.rs.hbs`**

```rust
#[allow(warnings)]
mod bindings;

use bindings::Guest;

struct Component;

impl Guest for Component {}

bindings::export!(Component with_types_in bindings);
```

- [ ] **Step 7: Create `wasm-component/wit/world.wit.hbs`**

```
package refarm:{{name}}@0.1.0;

world {{name}} {
}
```

- [ ] **Step 8: Create `ui-library/package.json.hbs`**

```
{
  "name": "@refarm.dev/{{name}}",
  "version": "0.1.0",
  "private": {{privateStr}},
  "description": "{{description}}",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./styles/*": "./src/*"
  },
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "dev": "tsc --project tsconfig.build.json --watch",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "@refarm.dev/tsconfig": "workspace:*",
    "typescript": "^6.0.3",
    "vitest": "^4.1.4"
  }
}
```

- [ ] **Step 9: Create `ui-library/tsconfig.json.hbs`** (same content as buildable)

```
{
	"extends": ["../../tsconfig.json", "@refarm.dev/tsconfig/buildable.json"],
	"compilerOptions": {
		"outDir": "dist",
		"baseUrl": "../.."
	},
	"include": ["src/**/*"]
}
```

- [ ] **Step 10: Create `ui-library/tsconfig.build.json.hbs`** (same as buildable)

```
{
	"extends": ["./tsconfig.json", "@refarm.dev/tsconfig/build.json"],
	"compilerOptions": {
		"rootDir": "src"
	}
}
```

- [ ] **Step 11: Create `ui-library/src/index.ts.hbs`**

```
export const {{constantName}}_CAPABILITY = "{{name}}:v1" as const;
```

- [ ] **Step 12: Create `ui-library/src/index.test.ts.hbs`**

```
import { describe, it, expect } from "vitest";
import { {{constantName}}_CAPABILITY } from "./index.js";

describe("{{name}}", () => {
  it("exports capability marker", () => {
    expect({{constantName}}_CAPABILITY).toBe("{{name}}:v1");
  });
});
```

- [ ] **Step 13: Create `js-tool/package.json.hbs`**

```
{
  "name": "@refarm.dev/{{name}}",
  "version": "0.1.0",
  "private": {{privateStr}},
  "description": "{{description}}",
  "type": "module",
  "main": "./src/cli.mjs",
  "bin": {
    "{{name}}": "./src/cli.mjs"
  },
  "scripts": {
    "test": "node --test src/**/*.test.mjs"
  }
}
```

- [ ] **Step 14: Create `js-tool/src/cli.mjs.hbs`**

```javascript
#!/usr/bin/env node
console.log("{{name}}");
```

- [ ] **Step 15: Create `config-pkg/package.json.hbs`**

```
{
  "name": "@refarm.dev/{{name}}",
  "version": "0.1.0",
  "private": {{privateStr}},
  "description": "{{description}}",
  "publishConfig": {
    "access": "public"
  }
}
```

- [ ] **Step 16: Smoke-test source-only generator**

```bash
pnpm turbo gen package
# Enter: test-source-v1 / source-only / Test / y
ls packages/test-source-v1/
# Expected: package.json  src/  tsconfig.json
rm -rf packages/test-source-v1
```

Also undo the `tsconfig.json` paths entry added for `test-source-v1`.

- [ ] **Step 17: Commit all remaining templates**

```bash
git add turbo/generators/templates/
git commit -m "feat(scaffold): templates for source-only, wasm-component, ui-library, js-tool, config-pkg"
```

---

## Task 4: Conformance linter (`scripts/validate-packages.mjs`)

**Files:**
- Create: `scripts/validate-packages.mjs`

- [ ] **Step 1: Create `scripts/validate-packages.mjs`**

```javascript
#!/usr/bin/env node
// Validates that every package/* conforms to its canonical scaffold type.
// Classification is automatic (no extra fields needed) with one escape hatch:
//   "scaffold": { "type": "exempt", "reason": "..." } in package.json

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function classifyPackage(pkgDir) {
  const pkg = readJson(join(pkgDir, "package.json"));
  if (!pkg) return { type: "no-package-json" };

  const scaffold = pkg.scaffold;
  if (scaffold?.type === "exempt") return { type: "exempt", reason: scaffold.reason ?? "(no reason given)" };

  const hasCargo = existsSync(join(pkgDir, "Cargo.toml"));
  const scripts = pkg.scripts ?? {};
  const main = pkg.main ?? "";
  const exports = pkg.exports ?? {};

  if (hasCargo && scripts["build:wasm"]) return { type: "wasm-component", pkg };
  if (hasCargo) return { type: "rust-only" };
  if (/^\.\/src\/.+\.ts$/.test(main)) return { type: "source-only", pkg };
  if (/^\.\/src\/.+\.(mjs|js)$/.test(main)) return { type: "js-tool", pkg };

  const hasStylesExport = Object.keys(exports).some((k) => k.startsWith("./styles/"));
  if (hasStylesExport && main.startsWith("./dist/")) return { type: "ui-library", pkg };

  const buildScript = scripts.build ?? "";
  if ((main.startsWith("./dist/") || exportsToDist(exports)) && buildScript.includes("tsc")) {
    return { type: "buildable", pkg };
  }

  if (!main && !buildScript) return { type: "config-pkg", pkg };

  return { type: "unknown", pkg };
}

function exportsToDist(exports) {
  if (typeof exports === "string") return exports.startsWith("./dist/");
  if (typeof exports === "object") {
    return Object.values(exports).some((v) =>
      typeof v === "string"
        ? v.startsWith("./dist/")
        : typeof v === "object" && Object.values(v).some((vv) => typeof vv === "string" && vv.startsWith("./dist/"))
    );
  }
  return false;
}

function validateBuildable(pkgDir, pkg) {
  const violations = [];

  // tsconfig.json must extend buildable.json preset
  const tsconfig = readJson(join(pkgDir, "tsconfig.json"));
  if (!tsconfig) {
    violations.push("tsconfig.json missing");
  } else {
    const ext = [tsconfig.extends].flat();
    if (!ext.some((e) => e?.includes("buildable.json"))) {
      violations.push("tsconfig.json does not extend @refarm.dev/tsconfig/buildable.json");
    }
  }

  // tsconfig.build.json must exist and extend build.json preset
  const tsconfigBuild = readJson(join(pkgDir, "tsconfig.build.json"));
  if (!tsconfigBuild) {
    violations.push("tsconfig.build.json missing");
  } else {
    const ext = [tsconfigBuild.extends].flat();
    if (!ext.some((e) => e?.includes("build.json"))) {
      violations.push("tsconfig.build.json does not extend @refarm.dev/tsconfig/build.json");
    }
  }

  // package.json must have build script with tsc
  if (!(pkg.scripts?.build ?? "").includes("tsc")) {
    violations.push('script "build" must invoke tsc');
  }

  // exports["."] must have import + types pointing to dist/
  const dot = pkg.exports?.["."];
  if (!dot || typeof dot !== "object") {
    violations.push('exports["."] must be an object with "import" and "types" fields');
  } else {
    if (!dot.import?.startsWith("./dist/")) violations.push('exports["."].import must point to dist/');
    if (!dot.types?.startsWith("./dist/")) violations.push('exports["."].types must point to dist/');
  }

  return violations;
}

function validateSourceOnly(pkgDir, pkg) {
  const violations = [];

  if (!existsSync(join(pkgDir, "tsconfig.json"))) {
    violations.push("tsconfig.json missing");
  }
  if (existsSync(join(pkgDir, "tsconfig.build.json"))) {
    violations.push("should not have tsconfig.build.json (source-only packages do not build)");
  }
  const buildScript = pkg.scripts?.build ?? "";
  if (buildScript && buildScript.includes("tsc")) {
    violations.push('script "build" should not compile TypeScript (source-only package)');
  }

  return violations;
}

function validateWasmComponent(pkgDir, pkg) {
  const violations = [];

  if (!existsSync(join(pkgDir, "Cargo.toml"))) violations.push("Cargo.toml missing");
  if (!pkg.scripts?.["build:wasm"]) violations.push('script "build:wasm" missing');
  if (!pkg.scripts?.["build:transpile"]) violations.push('script "build:transpile" missing');
  if (!pkg.scripts?.build) violations.push('script "build" missing');

  return violations;
}

function validateJsTool(pkgDir, pkg) {
  const violations = [];

  if (!pkg.main?.startsWith("./src/")) {
    violations.push("main must point to src/");
  }
  if (existsSync(join(pkgDir, "tsconfig.build.json"))) {
    violations.push("should not have tsconfig.build.json");
  }

  return violations;
}

function validateConfigPkg(pkgDir, pkg) {
  const violations = [];

  if (exportsToDist(pkg.exports ?? {})) {
    violations.push("exports must not point to dist/ for config packages");
  }
  if (existsSync(join(pkgDir, "tsconfig.build.json"))) {
    violations.push("should not have tsconfig.build.json");
  }

  return violations;
}

const packageDirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => join(PACKAGES_DIR, d.name));

let violations = 0;
let exemptions = 0;

console.log(`Validating ${packageDirs.length} packages...\n`);

for (const pkgDir of packageDirs) {
  const name = pkgDir.split("/").at(-1);
  const { type, pkg, reason } = classifyPackage(pkgDir);

  if (type === "exempt") {
    console.log(`  ~ ${name.padEnd(30)} exempt — ${reason}`);
    exemptions++;
    continue;
  }
  if (type === "rust-only" || type === "no-package-json") {
    // rust-only packages have no JS scaffold requirements; directories without package.json are not packages
    continue;
  }
  if (type === "unknown") {
    console.log(`  ? ${name.padEnd(30)} unknown type — cannot classify`);
    violations++;
    continue;
  }

  let pkgViolations = [];
  if (type === "buildable" || type === "ui-library") pkgViolations = validateBuildable(pkgDir, pkg);
  else if (type === "source-only") pkgViolations = validateSourceOnly(pkgDir, pkg);
  else if (type === "wasm-component") pkgViolations = validateWasmComponent(pkgDir, pkg);
  else if (type === "js-tool") pkgViolations = validateJsTool(pkgDir, pkg);
  else if (type === "config-pkg") pkgViolations = validateConfigPkg(pkgDir, pkg);

  if (pkgViolations.length === 0) {
    console.log(`  ✓ ${name.padEnd(30)} ${type}`);
  } else {
    for (const v of pkgViolations) {
      console.log(`  ✗ ${name.padEnd(30)} ${type} — ${v}`);
      violations++;
    }
  }
}

console.log();
if (violations > 0) {
  console.log(`${violations} violation(s) found.`);
  console.log(`Run \`pnpm turbo gen package\` to see the expected scaffold for each type.`);
  process.exit(1);
} else {
  console.log(`All packages conform to their scaffold type. ${exemptions > 0 ? `(${exemptions} exempt)` : ""}`);
}
```

- [ ] **Step 2: Make executable and run against current repo**

```bash
chmod +x scripts/validate-packages.mjs
node scripts/validate-packages.mjs 2>&1
```

Expected: exits with code 1, listing violations for `sower` and `barn`. All 13 recently-migrated packages show `✓ buildable`.

- [ ] **Step 3: Confirm exit code**

```bash
node scripts/validate-packages.mjs; echo "exit: $?"
```

Expected: `exit: 1` (because sower and barn are not yet conformant).

- [ ] **Step 4: Add `validate-packages` script to root package.json**

In `package.json` root, inside `"scripts"`:
```json
"validate-packages": "node scripts/validate-packages.mjs"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/validate-packages.mjs package.json
git commit -m "feat(scaffold): validate-packages linter — classifies and checks all package types"
```

---

## Task 5: Add `validate-scaffold` CI job

**Files:**
- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: Read the `quality` job definition**

Open `.github/workflows/test.yml` at line 238. The `quality` job uses `actions/checkout@...` and `pnpm/action-setup`. Copy that pattern.

- [ ] **Step 2: Add the new job**

Insert the following job in `.github/workflows/test.yml` directly after the `changes` job (before `quality:` at line 238). The job needs no `needs:` dependency — it runs in parallel with `quality`.

```yaml
  validate-scaffold:
    name: Validate package scaffold
    runs-on: ubuntu-latest
    timeout-minutes: 5
    needs: changes
    if: needs.changes.outputs.code_changes == 'true'
    steps:
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - name: Validate package scaffold
        run: node scripts/validate-packages.mjs
```

Note: no `pnpm` setup needed — the script uses only Node.js built-ins.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: add validate-scaffold job — blocks PRs with non-conformant packages"
```

---

## Task 6: Mark tractor-ts exempt and migrate sower + barn

**Files:**
- Modify: `packages/tractor-ts/package.json`
- Modify: `packages/sower/tsconfig.json`
- Modify: `packages/sower/tsconfig.build.json`
- Modify: `packages/barn/tsconfig.json`
- Modify: `packages/barn/tsconfig.build.json`

### 6a: Mark tractor-ts exempt

`tractor-ts` uses `rootDir: ".."` (one level above `src/`) because it includes the sibling `tractor` Rust crate's generated types. This causes its `dist/` output to be `dist/src/index.js` rather than `dist/index.js`. This is a genuine technical deviation, not a conformance failure.

- [ ] **Step 1: Add exempt marker to `packages/tractor-ts/package.json`**

Open `packages/tractor-ts/package.json`. Add after `"name"`:

```json
"scaffold": {
  "type": "exempt",
  "reason": "rootDir set to '..' to include generated Rust bindings from sibling tractor crate; dist/src/ output path is intentional"
},
```

- [ ] **Step 2: Run linter and confirm tractor-ts is now `~`**

```bash
node scripts/validate-packages.mjs 2>&1 | grep "tractor-ts\|sower\|barn"
```

Expected:
```
  ~ tractor-ts                    exempt — rootDir set to '..' ...
  ✗ sower                         buildable — tsconfig.json does not extend @refarm.dev/tsconfig/buildable.json
  ✗ barn                          buildable — ...
```

### 6b: Migrate sower

Current `packages/sower/tsconfig.json` is a standalone config that doesn't extend the root tsconfig and has many inline compiler options. Replace it with the standard buildable pattern.

- [ ] **Step 3: Replace `packages/sower/tsconfig.json`**

```json
{
	"extends": ["../../tsconfig.json", "@refarm.dev/tsconfig/buildable.json"],
	"compilerOptions": {
		"outDir": "dist",
		"baseUrl": "../.."
	},
	"include": ["src/**/*"]
}
```

- [ ] **Step 4: Replace `packages/sower/tsconfig.build.json`**

Current content has `"noEmit": false` and `"emitDeclarationOnly": false` but is missing `rootDir`. Replace with:

```json
{
	"extends": ["./tsconfig.json", "@refarm.dev/tsconfig/build.json"],
	"compilerOptions": {
		"rootDir": "src"
	}
}
```

- [ ] **Step 5: Verify sower still builds**

```bash
pnpm --filter=@refarm.dev/sower run build 2>&1 | tail -5
```

Expected: exits 0, no TypeScript errors.

- [ ] **Step 6: Verify sower tests pass**

```bash
pnpm --filter=@refarm.dev/sower run test 2>&1 | tail -5
```

Expected: all tests pass.

### 6c: Migrate barn

Current `packages/barn/tsconfig.json` has `noEmit: true` (wrong for a buildable package) and `composite: false`. Current `packages/barn/tsconfig.build.json` is missing `composite: true`.

- [ ] **Step 7: Replace `packages/barn/tsconfig.json`**

```json
{
	"extends": ["../../tsconfig.json", "@refarm.dev/tsconfig/buildable.json"],
	"compilerOptions": {
		"outDir": "dist",
		"baseUrl": "../.."
	},
	"include": ["src/**/*"]
}
```

- [ ] **Step 8: Replace `packages/barn/tsconfig.build.json`**

```json
{
	"extends": ["./tsconfig.json", "@refarm.dev/tsconfig/build.json"],
	"compilerOptions": {
		"rootDir": "src"
	}
}
```

- [ ] **Step 9: Verify barn still builds**

```bash
pnpm --filter=@refarm.dev/barn run build 2>&1 | tail -5
```

Expected: exits 0.

- [ ] **Step 10: Verify barn tests pass**

```bash
pnpm --filter=@refarm.dev/barn run test 2>&1 | tail -5
```

Expected: all tests pass.

### 6d: Final linter run

- [ ] **Step 11: Run linter — must exit 0**

```bash
node scripts/validate-packages.mjs; echo "exit: $?"
```

Expected: `exit: 0`. All buildable packages show `✓`. `tractor-ts` shows `~`.

- [ ] **Step 12: Commit**

```bash
git add packages/tractor-ts/package.json \
        packages/sower/tsconfig.json packages/sower/tsconfig.build.json \
        packages/barn/tsconfig.json packages/barn/tsconfig.build.json
git commit -m "fix(scaffold): migrate sower + barn to buildable presets; exempt tractor-ts"
```

---

## Task 7: Capture the first migration-pack candidate

**Purpose:** Preserve what this plan teaches about Codemod-style package evolution without expanding the implementation scope. This is documentation-only unless a later plan explicitly implements a runner.

**Files:**
- Modify: `docs/superpowers/specs/2026-05-17-package-scaffold-design.md`

- [ ] **Step 1: Add a short "Migration Pack Candidate" section**

Append a section to the design doc that records package scaffold conformance as the first candidate migration pack:

```markdown
## Migration Pack Candidate

This scaffold/conformance work is a low-risk candidate for the migration-pack
profile described in `docs/research/codemod-strategic-assessment.md`.

The package does not need a new distribution mechanism. It would be a profile
inside the existing Refarm plugin/package model:

- intent: migrate package directories toward canonical scaffold types;
- detection: `scripts/validate-packages.mjs`;
- deterministic action: replace non-conformant package config with canonical templates;
- fixtures: representative package directories for buildable/source-only/js-tool/config-pkg;
- dry run: linter output plus planned file edits;
- validation: `node scripts/validate-packages.mjs`, scoped package builds/tests, and `git diff --check`;
- policy: protected packages require explicit handoff; generated artifacts are never edited.

First concrete target: the `sower` and `barn` buildable-preset migration already
listed in the implementation plan.
```

- [ ] **Step 2: Commit with the design docs**

If the implementation is being committed task-by-task, include this with the nearest documentation commit rather than creating a separate code change.

---

## Done criteria

- `pnpm turbo gen package` works interactively for all 6 types
- A generated `buildable` package builds and its test passes without any manual edits
- `node scripts/validate-packages.mjs` exits 0 on the current repo
- CI `validate-scaffold` job runs on every PR touching `packages/` or `scripts/`
- `sower` and `barn` pass the linter without exemptions
- The scaffold design doc records package scaffold conformance as the first migration-pack candidate
