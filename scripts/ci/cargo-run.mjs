#!/usr/bin/env node
import { spawnSync } from "node:child_process";
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

function cargoArtifactPath(rel) {
	const targetDir = process.env.CARGO_TARGET_DIR
		? path.resolve(process.env.CARGO_TARGET_DIR)
		: readConfiguredTargetDir() ?? path.resolve(process.cwd(), "target");
	return path.join(targetDir, rel);
}

const args = process.argv.slice(2);
const copies = [];

while (args[0] === "--copy") {
	args.shift();
	const fromRel = args.shift();
	const to = args.shift();
	if (!fromRel || !to) {
		console.error("usage: cargo-run.mjs [--copy <cargo-artifact-rel> <destination>] <cargo-args...>");
		process.exit(2);
	}
	copies.push({ from: cargoArtifactPath(fromRel), to: path.resolve(process.cwd(), to) });
}

if (args.length === 0) {
	console.error("usage: cargo-run.mjs [--copy <cargo-artifact-rel> <destination>] <cargo-args...>");
	process.exit(2);
}

const result = spawnSync("cargo", args, {
	cwd: process.cwd(),
	env: { ...process.env, RUSTUP_TOOLCHAIN: process.env.RUSTUP_TOOLCHAIN || "stable" },
	shell: false,
	stdio: "inherit",
});

if (result.error) {
	console.error(result.error.message);
	process.exit(1);
}

if (result.status !== 0) process.exit(result.status ?? 1);

for (const copy of copies) {
	fs.mkdirSync(path.dirname(copy.to), { recursive: true });
	fs.copyFileSync(copy.from, copy.to);
}
