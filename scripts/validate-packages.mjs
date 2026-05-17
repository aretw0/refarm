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
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new Error(`Failed to parse ${path}: ${err.message}`);
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

  const buildScript = scripts.build ?? "";

  // Contracts: buildable packages that OWN a conformance suite definition (src/conformance.ts).
  // Adapter packages run test:conformance against imported suites — they classify as buildable.
  const hasOwnConformanceDef =
    existsSync(join(pkgDir, "src/conformance.ts")) || existsSync(join(pkgDir, "src/conformance.js"));
  if (main.startsWith("./dist/") && hasOwnConformanceDef && buildScript.includes("tsc")) return { type: "contract-v1", pkg };

  if (/^\.\/src\/.+\.ts$/.test(main)) return { type: "source-only", pkg };
  if (/^\.\/src\/.+\.(mjs|js)$/.test(main)) return { type: "js-tool", pkg };

  const hasStylesExport = Object.keys(exports).some((k) => k.startsWith("./styles/"));
  if (hasStylesExport && main.startsWith("./dist/")) return { type: "ui-library", pkg };

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
        : v !== null && typeof v === "object" && Object.values(v).some((vv) => typeof vv === "string" && vv.startsWith("./dist/"))
    );
  }
  return false;
}

function usesVtconfig(pkgDir, pkg) {
  const devDeps = pkg.devDependencies ?? {};
  return "@refarm.dev/vtconfig" in devDeps;
}

function hasScript(pkg, ...names) {
  const scripts = pkg.scripts ?? {};
  return names.every((n) => n in scripts);
}

function noRawVitestDep(pkg) {
  const devDeps = pkg.devDependencies ?? {};
  return !("vitest" in devDeps);
}

function hasTestFiles(pkgDir) {
  function scan(dir) {
    if (!existsSync(dir)) return false;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      if (entry.isDirectory() && scan(join(dir, entry.name))) return true;
      if (entry.isFile() && /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(entry.name)) return true;
    }
    return false;
  }
  return scan(pkgDir);
}

function validateBuildable(pkgDir, pkg) {
  const violations = [];

  const tsconfig = readJson(join(pkgDir, "tsconfig.json"));
  if (!tsconfig) {
    violations.push("tsconfig.json missing");
  } else {
    const ext = [tsconfig.extends].flat();
    if (!ext.some((e) => e?.includes("buildable.json"))) {
      violations.push("tsconfig.json does not extend @refarm.dev/tsconfig/buildable.json");
    }
  }

  const tsconfigBuild = readJson(join(pkgDir, "tsconfig.build.json"));
  if (!tsconfigBuild) {
    violations.push("tsconfig.build.json missing");
  } else {
    const ext = [tsconfigBuild.extends].flat();
    if (!ext.some((e) => e?.includes("build.json"))) {
      violations.push("tsconfig.build.json does not extend @refarm.dev/tsconfig/build.json");
    }
  }

  if (!(pkg.scripts?.build ?? "").includes("tsc")) {
    violations.push('script "build" must invoke tsc');
  }

  const dot = pkg.exports?.["."];
  if (!dot || typeof dot !== "object") {
    violations.push('exports["."] must be an object with "import" and "types" fields');
  } else {
    if (!dot.import?.startsWith("./dist/")) violations.push('exports["."].import must point to dist/');
    if (!dot.types?.startsWith("./dist/")) violations.push('exports["."].types must point to dist/');
  }

  const withTests = hasTestFiles(pkgDir);
  if (!hasScript(pkg, "test")) violations.push('script "test" missing');
  if (!hasScript(pkg, "lint")) violations.push('script "lint" missing');
  if (withTests && !usesVtconfig(pkgDir, pkg)) violations.push('has test files but devDependencies missing @refarm.dev/vtconfig');
  if (!noRawVitestDep(pkg)) violations.push('devDependencies has raw "vitest" — use @refarm.dev/vtconfig instead');

  return violations;
}

function validateContractV1(pkgDir, pkg) {
  // Contract-v1 is a buildable with extra script requirements
  const violations = validateBuildable(pkgDir, pkg);

  if (!hasScript(pkg, "test:unit")) violations.push('script "test:unit" missing (should run conformance.test.ts)');
  if (!hasScript(pkg, "test:conformance")) violations.push('script "test:conformance" missing');

  const inMemorySrc = existsSync(join(pkgDir, "src/in-memory.ts")) || existsSync(join(pkgDir, "src/in-memory.js"));
  if (!inMemorySrc) violations.push("src/in-memory.ts missing (reference adapter required for contract-v1)");

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

  const withTests = hasTestFiles(pkgDir);
  if (!hasScript(pkg, "test")) violations.push('script "test" missing');
  if (withTests && !usesVtconfig(pkgDir, pkg)) violations.push('has test files but devDependencies missing @refarm.dev/vtconfig');
  if (!noRawVitestDep(pkg)) violations.push('devDependencies has raw "vitest" — use @refarm.dev/vtconfig instead');

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
    continue;
  }
  if (type === "unknown") {
    console.log(`  ? ${name.padEnd(30)} unknown type — cannot classify`);
    violations++;
    continue;
  }

  let pkgViolations = [];
  if (type === "contract-v1") pkgViolations = validateContractV1(pkgDir, pkg);
  else if (type === "buildable" || type === "ui-library") pkgViolations = validateBuildable(pkgDir, pkg);
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
  console.log(`Run \`pnpm turbo gen package\` to scaffold new packages correctly.`);
  process.exit(1);
} else {
  console.log(`All packages conform to their scaffold type. ${exemptions > 0 ? `(${exemptions} exempt)` : ""}`);
}
