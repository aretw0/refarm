#!/usr/bin/env node
/**
 * check-vitest-config-deps.mjs
 *
 * Finds phantom dependencies in vitest.config.ts files across the monorepo.
 * A phantom dep is a workspace package imported in vitest.config.ts that is
 * not declared in the package's devDependencies or dependencies.
 *
 * These work locally due to pnpm hoisting but fail in CI because vitest
 * creates a .vite-temp/ copy of the config where resolution is strict.
 *
 * Usage: node scripts/ci/check-vitest-config-deps.mjs
 * Exit 0 = clean. Exit 1 = phantom deps found.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const PACKAGES_DIR = join(ROOT, "packages");
const APPS_DIR = join(ROOT, "apps");

const colors = {
  reset: "\x1b[0m", red: "\x1b[31m",
  green: "\x1b[32m", yellow: "\x1b[33m", dim: "\x1b[2m",
};

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function extractWorkspaceImports(source) {
  const pattern = /from\s+["'](@refarm\.dev\/[^"']+)["']/g;
  const found = new Set();
  let m;
  while ((m = pattern.exec(source)) !== null) {
    const pkg = m[1].split("/").slice(0, 2).join("/");
    found.add(pkg);
  }
  return found;
}

function checkDir(dir) {
  const errors = [];
  if (!existsSync(dir)) return errors;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgDir = join(dir, entry.name);
    const configPath = join(pkgDir, "vitest.config.ts");
    const pkgJsonPath = join(pkgDir, "package.json");
    if (!existsSync(configPath) || !existsSync(pkgJsonPath)) continue;

    const source = readFileSync(configPath, "utf8");
    const pkg = readJson(pkgJsonPath);
    if (!pkg) continue;

    const allDeclared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]);

    for (const imp of extractWorkspaceImports(source)) {
      if (!allDeclared.has(imp)) {
        errors.push({ workspace: (dir === PACKAGES_DIR ? "packages" : "apps") + "/" + entry.name, missing: imp });
      }
    }
  }
  return errors;
}

const allErrors = [...checkDir(PACKAGES_DIR), ...checkDir(APPS_DIR)];

if (allErrors.length === 0) {
  console.log(`${colors.green}✓ vitest.config.ts phantom deps: none found${colors.reset}`);
  process.exit(0);
}

console.error(`${colors.red}✗ vitest.config.ts phantom dependencies detected${colors.reset}`);
console.error(`${colors.dim}  These work locally (pnpm hoisting) but fail in CI (.vite-temp context).${colors.reset}\n`);
for (const { workspace, missing } of allErrors) {
  console.error(`  ${colors.yellow}${workspace}${colors.reset}  missing devDependency: ${colors.red}${missing}${colors.reset}`);
  console.error(`  ${colors.dim}  Fix: add "${missing}": "workspace:*" to ${workspace}/package.json devDependencies${colors.reset}`);
}
console.error("");
process.exit(1);
