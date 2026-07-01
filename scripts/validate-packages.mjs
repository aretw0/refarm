#!/usr/bin/env node
// Validates that every package/* conforms to its canonical scaffold type.
// Classification is automatic (no extra fields needed) with one escape hatch:
//   "scaffold": { "type": "exempt", "reason": "..." } in package.json

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { packageBinaryCommand } from "../packages/config/src/package-manager.js";

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

  if (hasCargo && scripts["build:wasm"] && scripts["build:jco"]) return { type: "wasm-jco-component", pkg };
  if (hasCargo && scripts["build:wasm"]) return { type: "wasm-component", pkg };
  if (hasCargo) return { type: "rust-only" };

  const buildScript = scripts.build ?? "";

  // Behavioral contracts own a conformance suite definition (src/conformance.ts).
  // Adapter packages run test:conformance against imported suites — they classify as buildable.
  // Structural contracts are private type-shape packages without a runtime adapter surface.
  const hasOwnConformanceDef =
    existsSync(join(pkgDir, "src/conformance.ts")) || existsSync(join(pkgDir, "src/conformance.js"));
  if (main.startsWith("./dist/") && hasOwnConformanceDef && buildScript.includes("tsc")) return { type: "contract-v1", pkg };
  if (
    pkg.private === true &&
    typeof pkg.name === "string" &&
    pkg.name.endsWith("-contract-v1") &&
    main.startsWith("./dist/") &&
    buildScript.includes("tsc") &&
    !scripts["test:conformance"]
  ) {
    return { type: "structural-contract-v1", pkg };
  }

  if (/^\.\/src\/.+\.ts$/.test(main)) return { type: "source-only", pkg };
  if (/^\.\/src\/.+\.(mjs|js)$/.test(main)) return { type: "js-tool", pkg };

  if (
    main.startsWith("./dist/src/") &&
    buildScript.includes("tsc") &&
    existsSync(join(pkgDir, "tsconfig.build.json"))
  ) {
    return { type: "hybrid-bindings-package", pkg };
  }

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

function hasWorkspaceDependency(pkg, name) {
  const deps = pkg.dependencies ?? {};
  const devDeps = pkg.devDependencies ?? {};
  return name in deps || name in devDeps;
}

function hasScript(pkg, ...names) {
  const scripts = pkg.scripts ?? {};
  return names.every((n) => n in scripts);
}

function validateTestScriptRequiresTests(pkg) {
  const violations = [];
  const testScript = pkg.scripts?.test ?? "";
  if (testScript.includes("--passWithNoTests")) {
    violations.push('script "test" must not use --passWithNoTests unless package.json declares scaffold.type="exempt"');
  }
  return violations;
}

export function validatePublishSurface(pkg) {
  const violations = [];
  if (pkg?.private === true || pkg?.publishConfig?.access !== "public") {
    return violations;
  }

  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    return ["public packages must declare a non-empty files allowlist"];
  }

  let includesDist = false;
  let excludesDistTsBuildInfo = false;

  for (const entry of pkg.files) {
    if (typeof entry !== "string") {
      violations.push("files entries must be strings");
      continue;
    }
    if (entry === "dist") includesDist = true;
    if (entry === "!dist/**/*.tsbuildinfo") excludesDistTsBuildInfo = true;
    if (entry === "" || entry === ".") {
      violations.push('files must not include "." or empty entries');
    }
    if (entry.includes(".turbo") || entry.includes(".pi-lens") || entry.includes("node_modules")) {
      violations.push(`files entry "${entry}" must not include local cache/runtime state`);
    }
    if (!entry.startsWith("!") && entry.includes("tsbuildinfo")) {
      violations.push(`files entry "${entry}" must not include TypeScript incremental state`);
    }
  }

  if (includesDist && !excludesDistTsBuildInfo) {
    violations.push('files includes "dist" and must exclude "dist/**/*.tsbuildinfo"');
  }

  return violations;
}

export function validateRuntimeAgentPluginPackage(pkg) {
  const violations = [];
  if (pkg?.name !== "@refarm.dev/pi-agent") return violations;

  const files = Array.isArray(pkg.files) ? pkg.files : [];
  const requiredFiles = [
    "dist/pi_agent.wasm",
    "dist/plugin.json",
    "dist/jco",
  ];
  for (const entry of requiredFiles) {
    if (!files.includes(entry)) {
      violations.push(`runtime-agent plugin package files must include "${entry}"`);
    }
  }

  if (pkg.private !== true && pkg.publishConfig?.access !== "public") {
    violations.push("runtime-agent plugin package must declare publishConfig.access=\"public\" before publication");
  }

  const buildWasm = pkg.scripts?.["build:wasm"] ?? "";
  if (!buildWasm.includes("check:wit")) {
    violations.push('runtime-agent plugin build:wasm must run "check:wit" before building artifacts');
  }
  if (!buildWasm.includes("dist/pi_agent.wasm")) {
    violations.push('runtime-agent plugin build:wasm must write "dist/pi_agent.wasm"');
  }
  if (!buildWasm.includes("dist/plugin.json")) {
    violations.push('runtime-agent plugin build:wasm must write "dist/plugin.json"');
  }

  const buildJco = pkg.scripts?.["build:jco"] ?? "";
  if (!buildJco.includes("dist/pi_agent.wasm")) {
    violations.push('runtime-agent plugin build:jco must read "dist/pi_agent.wasm"');
  }
  if (!buildJco.includes("dist/jco")) {
    violations.push('runtime-agent plugin build:jco must write "dist/jco"');
  }

  return violations;
}

export function validateSiloPublicApi(pkg) {
  const violations = [];
  if (pkg?.name !== "@refarm.dev/silo") return violations;

  const requiredSubpaths = {
    "./collect": {
      import: "./dist/collect.js",
      types: "./dist/collect.d.ts",
    },
    "./key-manager": {
      import: "./dist/key-manager.js",
      types: "./dist/key-manager.d.ts",
    },
  };

  for (const [subpath, expected] of Object.entries(requiredSubpaths)) {
    const exported = pkg.exports?.[subpath];
    if (!exported || typeof exported !== "object") {
      violations.push(`silo public API must declare exports["${subpath}"]`);
      continue;
    }
    if (exported.import !== expected.import) {
      violations.push(`silo exports["${subpath}"].import must be "${expected.import}"`);
    }
    if (exported.types !== expected.types) {
      violations.push(`silo exports["${subpath}"].types must be "${expected.types}"`);
    }
  }

  return violations;
}

export function validateDsPublicApi(pkg) {
  const violations = [];
  if (pkg?.name !== "@refarm.dev/ds") return violations;

  const requiredSubpaths = {
    "./contract": {
      import: "./dist/contract.js",
      types: "./dist/contract.d.ts",
    },
    "./theme-conformance": {
      import: "./dist/theme-conformance.js",
      types: "./dist/theme-conformance.d.ts",
    },
    "./html": {
      import: "./dist/html.js",
      types: "./dist/html.d.ts",
    },
  };

  for (const [subpath, expected] of Object.entries(requiredSubpaths)) {
    const exported = pkg.exports?.[subpath];
    if (!exported || typeof exported !== "object") {
      violations.push(`ds public API must declare exports["${subpath}"]`);
      continue;
    }
    if (exported.import !== expected.import) {
      violations.push(`ds exports["${subpath}"].import must be "${expected.import}"`);
    }
    if (exported.types !== expected.types) {
      violations.push(`ds exports["${subpath}"].types must be "${expected.types}"`);
    }
  }

  return violations;
}

const WIT_COMPONENT_DISTRIBUTION_TARGETS = [
  {
    id: "agent-tools",
    packageDir: "packages/agent-tools",
    cargoPackage: "refarm:agent-tools",
    targetPath: "wit",
    targetWorld: "agent-tools-provider",
    witPath: "wit/world.wit",
    witPackage: "refarm:agent-tools@0.1.0",
    world: "agent-tools-provider",
    imports: ["host-spawn"],
    exports: ["agent-fs", "agent-shell", "structured-io"],
  },
  {
    id: "refarm-plugin",
    packageDir: "packages/refarm-plugin-wit",
    cargoPackage: "refarm:plugin",
    targetPath: "wit",
    witPath: "wit/refarm-plugin-host.wit",
    witPackage: "refarm:plugin@0.1.0",
    world: "refarm-plugin-host",
    imports: ["tractor-bridge", "model-bridge", "agent-fs", "agent-shell", "structured-io", "code-ops"],
    exports: ["integration"],
  },
];

export function validateWitComponentDistributionTarget(target, contents) {
  const violations = [];
  const cargoToml = contents?.cargoToml ?? "";
  const wit = contents?.wit ?? "";

  if (!cargoToml.includes("[package.metadata.component]")) {
    violations.push(`${target.id} Cargo.toml must declare [package.metadata.component]`);
  }
  if (!cargoToml.includes(`package = "${target.cargoPackage}"`)) {
    violations.push(`${target.id} Cargo.toml must declare component package "${target.cargoPackage}"`);
  }
  if (!cargoToml.includes("[package.metadata.component.target]")) {
    violations.push(`${target.id} Cargo.toml must declare [package.metadata.component.target]`);
  }
  if (!cargoToml.includes(`path = "${target.targetPath}"`)) {
    violations.push(`${target.id} Cargo.toml component target must point at "${target.targetPath}"`);
  }
  if (target.targetWorld && !cargoToml.includes(`world = "${target.targetWorld}"`)) {
    violations.push(`${target.id} Cargo.toml component target must declare world "${target.targetWorld}"`);
  }

  if (!wit.includes(`package ${target.witPackage};`)) {
    violations.push(`${target.id} WIT must declare package ${target.witPackage}`);
  }
  if (!wit.includes(`world ${target.world} {`)) {
    violations.push(`${target.id} WIT must declare world ${target.world}`);
  }
  for (const importName of target.imports) {
    if (!wit.includes(`import ${importName};`)) {
      violations.push(`${target.id} WIT world must import ${importName}`);
    }
  }
  for (const exportName of target.exports) {
    if (!wit.includes(`export ${exportName};`)) {
      violations.push(`${target.id} WIT world must export ${exportName}`);
    }
  }

  return violations;
}

export function validateWitComponentDistributionPreflight(targets = WIT_COMPONENT_DISTRIBUTION_TARGETS) {
  const violations = [];
  for (const target of targets) {
    const packageDir = join(ROOT, target.packageDir);
    const cargoPath = join(packageDir, "Cargo.toml");
    const witPath = join(packageDir, target.witPath);
    if (!existsSync(cargoPath)) {
      violations.push(`${target.id} Cargo.toml missing at ${target.packageDir}/Cargo.toml`);
      continue;
    }
    if (!existsSync(witPath)) {
      violations.push(`${target.id} WIT missing at ${target.packageDir}/${target.witPath}`);
      continue;
    }
    violations.push(
      ...validateWitComponentDistributionTarget(target, {
        cargoToml: readFileSync(cargoPath, "utf8"),
        wit: readFileSync(witPath, "utf8"),
      }),
    );
  }
  return violations;
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

  if (!hasWorkspaceDependency(pkg, "@refarm.dev/tsconfig")) {
    violations.push('dependencies/devDependencies missing @refarm.dev/tsconfig');
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

function validateStructuralContractV1(pkgDir, pkg) {
  const violations = validateBuildable(pkgDir, pkg);

  if (hasScript(pkg, "test:conformance")) {
    violations.push('script "test:conformance" must not be declared for structural-contract-v1');
  }

  const hasOwnConformanceDef =
    existsSync(join(pkgDir, "src/conformance.ts")) || existsSync(join(pkgDir, "src/conformance.js"));
  if (hasOwnConformanceDef) {
    violations.push("src/conformance.* present — use contract-v1 scaffold instead");
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

  const withTests = hasTestFiles(pkgDir);
  if (!hasScript(pkg, "test")) violations.push('script "test" missing');
  if (withTests && !usesVtconfig(pkgDir, pkg)) violations.push('has test files but devDependencies missing @refarm.dev/vtconfig');
  if (!noRawVitestDep(pkg)) violations.push('devDependencies has raw "vitest" — use @refarm.dev/vtconfig instead');

  return violations;
}

export function validateWasmComponent(pkgDir, pkg) {
  const violations = [];

  if (!existsSync(join(pkgDir, "Cargo.toml"))) violations.push("Cargo.toml missing");
  if (!pkg.scripts?.["build:wasm"]) violations.push('script "build:wasm" missing');
  if (!pkg.scripts?.["build:transpile"]) violations.push('script "build:transpile" missing');
  if (!pkg.scripts?.build) violations.push('script "build" missing');

  if (pkg.private !== true && pkg.publishConfig?.access === "public") {
    if (typeof pkg.main !== "string" || !pkg.main.endsWith(".js")) {
      violations.push("public WASM component packages must declare a JavaScript main entry");
    }
    if (typeof pkg.types !== "string" || !pkg.types.endsWith(".d.ts")) {
      violations.push("public WASM component packages must declare a .d.ts types entry");
    }

    const dot = pkg.exports?.["."];
    if (!dot || typeof dot !== "object") {
      violations.push('public WASM component packages must declare exports["."] with "import" and "types" fields');
    } else {
      if (dot.import !== pkg.main) {
        violations.push('public WASM component exports["."].import must match package main');
      }
      if (dot.types !== pkg.types) {
        violations.push('public WASM component exports["."].types must match package types');
      }
    }
  }

  return violations;
}

function validateWasmJcoComponent(pkgDir, pkg) {
  const violations = [];

  if (!existsSync(join(pkgDir, "Cargo.toml"))) violations.push("Cargo.toml missing");
  if (!pkg.scripts?.["build:wasm"]) violations.push('script "build:wasm" missing');
  if (!pkg.scripts?.["build:jco"]) violations.push('script "build:jco" missing');
  if (!pkg.scripts?.build) violations.push('script "build" missing');
  if (!pkg.scripts?.test) violations.push('script "test" missing');
  if (!pkg.scripts?.["test:unit"]) violations.push('script "test:unit" missing');

  return violations;
}

function validateHybridBindingsPackage(pkgDir, pkg) {
  const violations = [];
  const tsconfig = readJson(join(pkgDir, "tsconfig.json"));
  const tsconfigBuild = readJson(join(pkgDir, "tsconfig.build.json"));

  if (!tsconfig) {
    violations.push("tsconfig.json missing");
  } else if (tsconfig.compilerOptions?.rootDir !== "..") {
    violations.push('tsconfig.json compilerOptions.rootDir must be ".."');
  }

  if (!tsconfigBuild) {
    violations.push("tsconfig.build.json missing");
  } else {
    if (tsconfigBuild.compilerOptions?.rootDir !== ".") {
      violations.push('tsconfig.build.json compilerOptions.rootDir must be "."');
    }
    const includes = Array.isArray(tsconfigBuild.include) ? tsconfigBuild.include : [];
    if (!includes.includes("src/**/*")) {
      violations.push('tsconfig.build.json include missing "src/**/*"');
    }
    if (!includes.includes("test/test-utils.ts")) {
      violations.push('tsconfig.build.json include missing "test/test-utils.ts"');
    }
  }

  if (!pkg.main?.startsWith("./dist/src/")) {
    violations.push("main must point to dist/src/");
  }
  if (!pkg.types?.startsWith("./dist/src/")) {
    violations.push("types must point to dist/src/");
  }

  const dot = pkg.exports?.["."];
  if (!dot || typeof dot !== "object") {
    violations.push('exports["."] must be an object with "import" and "types" fields');
  } else {
    if (!dot.import?.startsWith("./dist/src/")) violations.push('exports["."].import must point to dist/src/');
    if (!dot.types?.startsWith("./dist/src/")) violations.push('exports["."].types must point to dist/src/');
  }

  const testUtils = pkg.exports?.["./test/test-utils"];
  if (!testUtils || typeof testUtils !== "object") {
    violations.push('exports["./test/test-utils"] must be declared');
  } else {
    if (!testUtils.default?.startsWith("./dist/test/")) {
      violations.push('exports["./test/test-utils"].default must point to dist/test/');
    }
    if (!testUtils.types?.startsWith("./dist/test/")) {
      violations.push('exports["./test/test-utils"].types must point to dist/test/');
    }
  }

  for (const script of ["build", "lint", "type-check", "type-check:dist", "test", "test:unit"]) {
    if (!hasScript(pkg, script)) violations.push(`script "${script}" missing`);
  }
  if (!(pkg.scripts?.build ?? "").includes("tsc")) {
    violations.push('script "build" must invoke tsc');
  }
  if (!hasWorkspaceDependency(pkg, "@refarm.dev/tsconfig")) {
    violations.push('dependencies/devDependencies missing @refarm.dev/tsconfig');
  }
  if (!hasWorkspaceDependency(pkg, "@refarm.dev/vtconfig")) {
    violations.push('dependencies/devDependencies missing @refarm.dev/vtconfig');
  }
  if (!noRawVitestDep(pkg)) violations.push('devDependencies has raw "vitest" — use @refarm.dev/vtconfig instead');

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

const APPS_DIR = join(ROOT, "apps");

function validateApp(pkgDir, pkg) {
  const violations = [];
  const devDeps = pkg.devDependencies ?? {};
  if (devDeps["vitest"] && !devDeps["@refarm.dev/vtconfig"]) {
    violations.push('raw "vitest" devDep without @refarm.dev/vtconfig — use vtconfig for swap-readiness');
  }
  return violations;
}

export function validatePackageManagerConfig(rootPkg) {
  const violations = [];
  if (rootPkg?.pnpm && Object.keys(rootPkg.pnpm).length > 0) {
    violations.push("package.json must not declare pnpm settings; use pnpm-workspace.yaml so pnpm 11 reads the effective workspace policy");
  }
  return violations;
}

function validateRootPackageManagerConfig() {
  return validatePackageManagerConfig(readJson(join(ROOT, "package.json")));
}

function main() {
  const packageDirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(PACKAGES_DIR, d.name));

  const appDirs = existsSync(APPS_DIR)
    ? readdirSync(APPS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(APPS_DIR, d.name))
    : [];

  let violations = 0;
  let exemptions = 0;

  console.log(`Validating ${packageDirs.length} packages, ${appDirs.length} apps...\n`);

  const rootPackageManagerViolations = validateRootPackageManagerConfig();
  if (rootPackageManagerViolations.length === 0) {
    console.log("  ✓ root package manager config");
  } else {
    for (const v of rootPackageManagerViolations) {
      console.log(`  ✗ root package manager config — ${v}`);
      violations++;
    }
  }

  const witComponentDistributionViolations = validateWitComponentDistributionPreflight();
  if (witComponentDistributionViolations.length === 0) {
    console.log("  ✓ WIT component distribution preflight");
  } else {
    for (const v of witComponentDistributionViolations) {
      console.log(`  ✗ WIT component distribution preflight — ${v}`);
      violations++;
    }
  }

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
    else if (type === "structural-contract-v1") pkgViolations = validateStructuralContractV1(pkgDir, pkg);
    else if (type === "buildable" || type === "ui-library") pkgViolations = validateBuildable(pkgDir, pkg);
    else if (type === "source-only") pkgViolations = validateSourceOnly(pkgDir, pkg);
    else if (type === "wasm-component") pkgViolations = validateWasmComponent(pkgDir, pkg);
    else if (type === "wasm-jco-component") pkgViolations = validateWasmJcoComponent(pkgDir, pkg);
    else if (type === "hybrid-bindings-package") pkgViolations = validateHybridBindingsPackage(pkgDir, pkg);
    else if (type === "js-tool") pkgViolations = validateJsTool(pkgDir, pkg);
    else if (type === "config-pkg") pkgViolations = validateConfigPkg(pkgDir, pkg);
    pkgViolations.push(...validateTestScriptRequiresTests(pkg));
    pkgViolations.push(...validatePublishSurface(pkg));
    pkgViolations.push(...validateRuntimeAgentPluginPackage(pkg));
    pkgViolations.push(...validateSiloPublicApi(pkg));
    pkgViolations.push(...validateDsPublicApi(pkg));

    if (pkgViolations.length === 0) {
      console.log(`  ✓ ${name.padEnd(30)} ${type}`);
    } else {
      for (const v of pkgViolations) {
        console.log(`  ✗ ${name.padEnd(30)} ${type} — ${v}`);
        violations++;
      }
    }
  }

  for (const appDir of appDirs) {
    const name = "apps/" + appDir.split("/").at(-1);
    const pkg = readJson(join(appDir, "package.json"));
    if (!pkg) continue;
    if (pkg.scaffold?.type === "exempt") {
      console.log(`  ~ ${name.padEnd(30)} exempt — ${pkg.scaffold.reason ?? "(no reason given)"}`);
      exemptions++;
      continue;
    }
    const appViolations = [
      ...validateApp(appDir, pkg),
      ...validateTestScriptRequiresTests(pkg),
    ];
    if (appViolations.length === 0) {
      console.log(`  ✓ ${name.padEnd(30)} app`);
    } else {
      for (const v of appViolations) {
        console.log(`  ✗ ${name.padEnd(30)} app — ${v}`);
        violations++;
      }
    }
  }

  console.log();
  if (violations > 0) {
    console.log(`${violations} violation(s) found.`);
    const scaffold = packageBinaryCommand("turbo", ["gen", "package"], { cwd: ROOT });
    console.log(`Run \`${scaffold.display}\` to scaffold new packages correctly.`);
    process.exit(1);
  } else {
    console.log(`All packages conform to their scaffold type. ${exemptions > 0 ? `(${exemptions} exempt)` : ""}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
