#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../packages/release-engine/src/cli.mjs");

const result = spawnSync(process.execPath, [cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  encoding: "utf8",
});

if (result.error) {
  console.error("release-engine wrapper failed to execute:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
