#!/usr/bin/env node
/**
 * Installs pi-agent into ~/.refarm/plugins/@refarm/pi-agent/ so farmhand
 * can auto-load it on boot.
 *
 * What it does:
 *   1. Resolves the built pi_agent.wasm (CARGO_TARGET_DIR-aware).
 *   2. Creates the plugin directory under ~/.refarm/plugins/@refarm/pi-agent/.
 *   3. Copies the WASM binary there.
 *   4. Writes plugin.json with the absolute file:// entry and sha256 integrity.
 *
 * Usage:
 *   node scripts/pi-agent-install.mjs
 *   npm run agent:install
 */

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Resolve WASM binary path (CARGO_TARGET_DIR-aware, mirrors tractor-start.sh).
const cargoTarget = process.env.CARGO_TARGET_DIR;
const wasmSrc = cargoTarget
  ? path.join(cargoTarget, "wasm32-wasip1/release/pi_agent.wasm")
  : path.join(ROOT, "packages/pi-agent/target/wasm32-wasip1/release/pi_agent.wasm");

if (!existsSync(wasmSrc)) {
  console.error(`[pi-agent-install] WASM binary not found: ${wasmSrc}`);
  console.error(
    "  Build first: cd packages/pi-agent && cargo component build --release",
  );
  process.exit(1);
}

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
