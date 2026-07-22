#!/usr/bin/env node
/**
 * Installs agent into $REFARM_HOME/plugins/@refarm/agent/ so the
 * runtime can auto-load it on boot.
 *
 * WASM path resolution comes from the shared cargo-target resolver
 * (scripts/lib/cargo-target.mjs): $CARGO_TARGET_DIR env var, then target-dir
 * in .cargo/config.toml (anchored to the repo root), then .cache/cargo-target.
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
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { agentWasmPath } from "./lib/cargo-target.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const wasmCandidate = agentWasmPath(ROOT);
const wasmSrc = existsSync(wasmCandidate) ? wasmCandidate : null;

if (!wasmSrc) {
  console.error(`[agent-install] WASM binary not found at: ${wasmCandidate}`);
  console.error("\nBuild first:");
  console.error("  cargo component build --manifest-path packages/agent/Cargo.toml --release");
  process.exit(1);
}

console.log(`[agent-install] Found WASM at: ${wasmSrc}`);

// Install destination — scoped path mirrors npm convention; canonical id is in plugin.json.
const refarmHome = process.env.REFARM_HOME?.trim() || path.join(os.homedir(), ".refarm");
const pluginDir = path.join(refarmHome, "plugins/@refarm/agent");
mkdirSync(pluginDir, { recursive: true });

// The installed code entry uses the CANONICAL per-format filename `plugin.wasm` — the
// same name the start script (scripts/tractor-start.sh), the daemon `--plugin` arg, and
// the CLI installer (apps/refarm/src/commands/plugin-install-from-path.ts, ENTRY_FALLBACK
// = plugin.wasm) all resolve. A prior version wrote `agent.wasm`, which left an orphan
// this dev script overwrote but the runtime never read — so a stale `agent.wasm` could
// sit forever beside a fresh manifest. Write the canonical name and sweep the legacy one.
const wasmDest = path.join(pluginDir, "plugin.wasm");
const legacyWasmDest = path.join(pluginDir, "agent.wasm");
if (existsSync(legacyWasmDest)) {
  rmSync(legacyWasmDest, { force: true });
  console.log(`[agent-install] Removed legacy ${legacyWasmDest} (canonical name is plugin.wasm)`);
}
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
