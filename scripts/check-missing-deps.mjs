#!/usr/bin/env node
/**
 * scripts/check-missing-deps.mjs
 *
 * Scans TypeScript source files (src/ and test/) in every workspace package
 * and reports external imports that are not declared in that package's
 * package.json (dependencies, devDependencies, peerDependencies).
 *
 * Also scans scripts/ (root-level .mjs/.ts files) against the root
 * package.json — catches gaps like missing workspace packages used in CI
 * scripts that run directly via `node scripts/...`.
 *
 * Under pnpm's non-hoisted layout each package can only resolve what it
 * declares. npm's hoisting used to make transitive deps silently available;
 * pnpm exposes these gaps at install time — this script catches them locally
 * before CI does.
 *
 * Packages declared in the ROOT package.json (dev or regular) are accessible
 * to all workspace packages via Node.js module resolution going up the tree,
 * so they are excluded from the "missing" report.
 *
 * Usage:
 *   node scripts/check-missing-deps.mjs           # check all packages
 *   node scripts/check-missing-deps.mjs --src-only # skip test/ files
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, relative } from "path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SRC_ONLY = process.argv.includes("--src-only");

// Node.js built-in module list (node: prefix + bare names)
const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
  "events", "fs", "http", "http2", "https", "inspector", "module", "net",
  "os", "path", "perf_hooks", "process", "punycode", "querystring",
  "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
  "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads",
  "zlib",
]);

function readJson(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function findTsFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".turbo", ".git"].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findTsFiles(full, files);
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function extractImports(src) {
  const specifiers = new Set();
  const patterns = [
    /(?:^|\n)\s*import\s+(?:type\s+)?(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+(?:type\s+)?(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]/g,
    /require\(['"]([^'"]+)['"]\)/g,
    /import\(['"]([^'"]+)['"]\)/g,
  ];
  for (const re of patterns) {
    for (const [, spec] of src.matchAll(re)) {
      if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("~")) continue;
      if (spec.startsWith("node:")) continue;
      const bare = spec.startsWith("@")
        ? spec.split("/").slice(0, 2).join("/")
        : spec.split("/")[0];
      if (!NODE_BUILTINS.has(bare)) specifiers.add(bare);
    }
  }
  return specifiers;
}

function resolveWorkspaceDirs() {
  const dirs = [];
  const globRoots = ["apps", "packages", "validations", "templates"];
  for (const g of globRoots) {
    const base = join(ROOT, g);
    if (!existsSync(base)) continue;
    for (const top of readdirSync(base, { withFileTypes: true })) {
      if (!top.isDirectory()) continue;
      const topDir = join(base, top.name);
      if (existsSync(join(topDir, "package.json"))) dirs.push(topDir);
      // One level deeper (e.g. validations/wasm-plugin/host)
      for (const sub of readdirSync(topDir, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        const subDir = join(topDir, sub.name);
        if (existsSync(join(subDir, "package.json"))) dirs.push(subDir);
      }
    }
  }
  return [...new Set(dirs)];
}

// Packages declared at root are accessible to all via Node.js resolution
const rootPkg = readJson(join(ROOT, "package.json")) ?? {};
const rootDeclared = new Set([
  ...Object.keys(rootPkg.dependencies ?? {}),
  ...Object.keys(rootPkg.devDependencies ?? {}),
]);

// Read tsconfig paths to find local aliases (not real npm packages)
function getTsconfigPathAliases(dir) {
  const aliases = new Set();
  const configs = ["tsconfig.json", "tsconfig.build.json"];
  for (const cfg of configs) {
    const data = readJson(join(dir, cfg));
    if (!data?.compilerOptions?.paths) continue;
    for (const key of Object.keys(data.compilerOptions.paths)) {
      // Normalize: "@scope/pkg/*" → "@scope/pkg"
      const bare = key.startsWith("@")
        ? key.replace(/\/\*$/, "").split("/").slice(0, 2).join("/")
        : key.replace(/\/\*$/, "").split("/")[0];
      aliases.add(bare);
    }
  }
  return aliases;
}

const pkgDirs = resolveWorkspaceDirs();
const problems = [];

for (const dir of pkgDirs) {
  const pkgJson = readJson(join(dir, "package.json"));
  if (!pkgJson) continue;

  const declared = new Set([
    ...Object.keys(pkgJson.dependencies ?? {}),
    ...Object.keys(pkgJson.devDependencies ?? {}),
    ...Object.keys(pkgJson.peerDependencies ?? {}),
  ]);
  const pathAliases = getTsconfigPathAliases(dir);

  const dirsToScan = [join(dir, "src")];
  if (!SRC_ONLY) dirsToScan.push(join(dir, "test"));

  const missing = new Map();
  for (const scanDir of dirsToScan) {
    for (const file of findTsFiles(scanDir)) {
      const src = readFileSync(file, "utf8");
      for (const spec of extractImports(src)) {
        if (declared.has(spec)) continue;
        if (spec === pkgJson.name) continue;
        // Skip if declared at root (accessible via resolution going up)
        if (rootDeclared.has(spec)) continue;
        // Skip if resolved via tsconfig paths (local alias, not an npm package)
        if (pathAliases.has(spec)) continue;
        if (!missing.has(spec)) missing.set(spec, []);
        missing.get(spec).push(relative(ROOT, file));
      }
    }
  }

  if (missing.size > 0) {
    problems.push({ pkg: pkgJson.name, dir: relative(ROOT, dir), missing });
  }
}

// Scan root scripts/ (.mjs and .ts) against the root package.json.
// Root scripts run with root node_modules — any import must be declared there.
function findScriptFiles(dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".turbo", ".git"].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findScriptFiles(full, files);
    else if (/\.(mjs|ts)$/.test(entry.name)) files.push(full);
  }
  return files;
}

{
  const scriptsMissing = new Map();
  for (const file of findScriptFiles(join(ROOT, "scripts"))) {
    const src = readFileSync(file, "utf8");
    for (const spec of extractImports(src)) {
      if (rootDeclared.has(spec)) continue;
      if (!scriptsMissing.has(spec)) scriptsMissing.set(spec, []);
      scriptsMissing.get(spec).push(relative(ROOT, file));
    }
  }
  if (scriptsMissing.size > 0) {
    problems.push({ pkg: "refarm (root scripts/)", dir: "scripts", missing: scriptsMissing });
  }
}

if (problems.length === 0) {
  console.log("✓ All workspace packages declare their imports correctly.");
  process.exit(0);
}

console.error(`\n✗ ${problems.length} package(s) with undeclared imports:\n`);
for (const { pkg, dir, missing } of problems) {
  console.error(`  📦 ${pkg}  (${dir}/package.json)`);
  for (const [spec, files] of missing) {
    const display = files.length > 1 ? `${files[0]} +${files.length - 1} more` : files[0];
    console.error(`     missing: "${spec}"  ← ${display}`);
  }
  console.error();
}
process.exit(1);
