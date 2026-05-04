#!/usr/bin/env node
/**
 * Installs pi-agent into ~/.refarm/plugins/@refarm/pi-agent/ so farmhand
 * can auto-load it on boot.
 *
 * WASM path resolution order (first found wins):
 *   1. $CARGO_TARGET_DIR env var (set by devcontainer or ~/.bashrc)
 *   2. target-dir in .cargo/config.toml (same value, but read directly)
 *   3. packages/pi-agent/target/ (workspace fallback, no Docker volume)
 *
 * Usage:
 *   npm run agent:install
 *   node scripts/pi-agent-install.mjs
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
    console.log(`[pi-agent-install] CARGO_TARGET_DIR not in env; read from .cargo/config.toml: ${fromConfig}`);
    return fromConfig;
  }
  return null;
}

const cargoTarget = resolveCargoTarget();
const WASM_REL = "wasm32-wasip1/release/pi_agent.wasm";

const candidates = [
  cargoTarget && path.join(cargoTarget, WASM_REL),
  path.join(ROOT, "packages/pi-agent/target", WASM_REL),
].filter(Boolean);

const wasmSrc = candidates.find(existsSync);

if (!wasmSrc) {
  console.error("[pi-agent-install] WASM binary not found. Searched:");
  for (const c of candidates) console.error(`  ${c}`);
  console.error("\nBuild first:");
  console.error("  cd packages/pi-agent && cargo component build --release");
  process.exit(1);
}

console.log(`[pi-agent-install] Found WASM at: ${wasmSrc}`);

// Install destination.
const pluginDir = path.join(os.homedir(), ".refarm/plugins/@refarm/pi-agent");
mkdirSync(pluginDir, { recursive: true });

const wasmDest = path.join(pluginDir, "pi_agent.wasm");
copyFileSync(wasmSrc, wasmDest);
console.log(`[pi-agent-install] Copied WASM → ${wasmDest}`);

// Compute SHA-256 integrity of the installed binary.
const wasmBytes = readFileSync(wasmDest);
const sha256 = createHash("sha256").update(wasmBytes).digest("hex");
const integrity = `sha256-${sha256}`;

// Read template metadata from repo.
const templatePath = path.join(ROOT, "packages/pi-agent/plugin.json");
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
console.log(`[pi-agent-install] Wrote manifest → ${manifestDest}`);
console.log(`[pi-agent-install] integrity: ${integrity}`);
console.log("[pi-agent-install] Done. Restart farmhand to pick up the plugin.");
