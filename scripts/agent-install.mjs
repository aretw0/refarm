#!/usr/bin/env node
/**
 * Installs agent into $REFARM_HOME/plugins/@refarm/agent/ so the
 * runtime can auto-load it on boot.
 *
 * WASM path resolution order (first found wins):
 *   1. $CARGO_TARGET_DIR env var (set by devcontainer or ~/.bashrc)
 *   2. target-dir in .cargo/config.toml (same value, but read directly)
 *   3. packages/agent/target/ (workspace fallback)
 *
 * Usage:
 *   <package-manager> run agent:install
 *   node scripts/agent-install.mjs
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Read target-dir from .cargo/config.toml without a TOML parser. */
function cargoTargetDirFromConfig() {
  const configPath = path.join(ROOT, ".cargo/config.toml");
  if (!existsSync(configPath)) return null;
  const content = readFileSync(configPath, "utf-8");
  const match = content.match(/^\s*target-dir\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
}

function resolveCargoTarget() {
  if (process.env.CARGO_TARGET_DIR) return process.env.CARGO_TARGET_DIR;
  const fromConfig = cargoTargetDirFromConfig();
  if (fromConfig) {
    console.log(`[agent-install] CARGO_TARGET_DIR not in env; read from .cargo/config.toml: ${fromConfig}`);
    return fromConfig;
  }
  return null;
}

const cargoTarget = resolveCargoTarget();
const WASM_REL = "wasm32-wasip1/release/agent.wasm";

const candidates = [
  cargoTarget && path.join(cargoTarget, WASM_REL),
  path.join(ROOT, "packages/agent/target", WASM_REL),
].filter(Boolean);

const wasmSrc = candidates.find(existsSync);

if (!wasmSrc) {
  console.error("[agent-install] WASM binary not found. Searched:");
  for (const c of candidates) console.error(`  ${c}`);
  console.error("\nBuild first:");
  console.error("  cargo component build --manifest-path packages/agent/Cargo.toml --release");
  process.exit(1);
}

console.log(`[agent-install] Found WASM at: ${wasmSrc}`);

// Install destination — scoped path mirrors npm convention; canonical id is in plugin.json.
const refarmHome = process.env.REFARM_HOME?.trim() || path.join(os.homedir(), ".refarm");
const pluginDir = path.join(refarmHome, "plugins/@refarm/agent");
mkdirSync(pluginDir, { recursive: true });

const wasmDest = path.join(pluginDir, "agent.wasm");
copyFileSync(wasmSrc, wasmDest);
console.log(`[agent-install] Copied WASM → ${wasmDest}`);

function ensureRefarmCliShim() {
  const installScript = path.join(ROOT, "scripts/install-refarm-cli.mjs");
  console.log("[agent-install] Installing refarm CLI shim through install-refarm-cli...");
  const install = spawnSync(process.execPath, [installScript, "--build"], {
    cwd: ROOT,
    stdio: "inherit",
  });

  if (install.status !== 0) {
    console.error("[agent-install] Failed to install refarm CLI shim.");
    process.exit(install.status ?? 1);
  }
}

ensureRefarmCliShim();

// Compute SHA-256 integrity of the installed binary.
const wasmBytes = readFileSync(wasmDest);
const sha256 = createHash("sha256").update(wasmBytes).digest("hex");
const integrity = `sha256-${sha256}`;

// Read template metadata from repo.
const templatePath = path.join(ROOT, "packages/agent/plugin.json");
const template = JSON.parse(readFileSync(templatePath, "utf-8"));
delete template._note;

// Inject computed fields.
const manifest = {
  ...template,
  entry: `file://${wasmDest}`,
  integrity,
};

const manifestDest = path.join(pluginDir, "plugin.json");
writeFileSync(manifestDest, JSON.stringify(manifest, null, 2) + "\n");
console.log(`[agent-install] Wrote manifest → ${manifestDest}`);
console.log(`[agent-install] integrity: ${integrity}`);
console.log("[agent-install] Done. Restart farmhand to pick up the plugin.");
