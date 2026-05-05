#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");

function readConfiguredTargetDir() {
	const configPath = path.join(repoRoot, ".cargo", "config.toml");
	if (!fs.existsSync(configPath)) return null;
	const content = fs.readFileSync(configPath, "utf8");
	const match = content.match(/^\s*target-dir\s*=\s*"([^"]+)"/m);
	if (!match) return null;
	return path.isAbsolute(match[1]) ? match[1] : path.resolve(repoRoot, match[1]);
}

const rel = process.argv[2];
if (!rel || rel.startsWith("-")) {
	console.error("usage: node scripts/ci/cargo-artifact-path.mjs <relative-artifact-path>");
	process.exit(2);
}

const targetDir = process.env.CARGO_TARGET_DIR
	? path.resolve(process.env.CARGO_TARGET_DIR)
	: readConfiguredTargetDir() ?? path.resolve(process.cwd(), "target");

process.stdout.write(path.join(targetDir, rel));
