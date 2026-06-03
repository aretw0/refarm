#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPackageScriptCommand } from "../packages/config/src/package-manager.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = path.join(ROOT, "apps/refarm/dist/index.js");
const LOADER_ENTRY = path.join(ROOT, "scripts/farmhand-node-register-loader.mjs");

function fail(message, status = 1) {
  console.error(`[install-refarm-cli] ${message}`);
  process.exit(status);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed.`, result.status ?? 1);
  }
}

function pathIncludes(directory) {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .some((entry) => path.resolve(entry) === path.resolve(directory));
}

function resolveBinDir() {
  if (process.env.REFARM_CLI_BIN_DIR) {
    return path.resolve(process.env.REFARM_CLI_BIN_DIR);
  }

  const npmGlobal = path.join(os.homedir(), ".npm-global/bin");
  const localBin = path.join(os.homedir(), ".local/bin");
  if (pathIncludes(npmGlobal)) {
    return npmGlobal;
  }

  if (pathIncludes(localBin)) {
    return localBin;
  }

  if (existsSync(npmGlobal)) {
    return npmGlobal;
  }

  return localBin;
}

const forceBuild = process.argv.includes("--build");

if (forceBuild || !existsSync(DIST_ENTRY)) {
  const build = createPackageScriptCommand({
    cwd: path.join(ROOT, "apps/refarm"),
    repoRoot: ROOT,
    script: "build",
  });
  console.log(`[install-refarm-cli] Building @refarm.dev/refarm with ${build.display}...`);
  run(build.command, build.args);
}

if (!existsSync(DIST_ENTRY)) {
  fail(`Missing dist entry after build: ${DIST_ENTRY}`);
}

chmodSync(DIST_ENTRY, 0o755);

const binDir = resolveBinDir();
mkdirSync(binDir, { recursive: true });

const shimPath = path.join(binDir, "refarm");
const shimBody = `#!/usr/bin/env bash
set -euo pipefail
exec node --import ${JSON.stringify(LOADER_ENTRY)} ${JSON.stringify(DIST_ENTRY)} "$@"
`;

writeFileSync(shimPath, shimBody);
chmodSync(shimPath, 0o755);

console.log(`[install-refarm-cli] Installed refarm shim -> ${shimPath}`);

if (!pathIncludes(binDir)) {
  console.warn(`[install-refarm-cli] WARN: ${binDir} is not in PATH.`);
}
