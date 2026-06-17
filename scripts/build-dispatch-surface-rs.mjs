#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const crateDir = path.resolve(repoRoot, "packages", "dispatch-surface-rs");
const distDir = path.resolve(crateDir, "dist");
const wasmPath = path.resolve(distDir, "dispatch_surface.wasm");
const pkgDir = path.resolve(crateDir, "pkg");
const cargoRun = path.resolve(repoRoot, "scripts", "ci", "cargo-run.mjs");

function fail(message, error) {
	console.error(message);
	if (error) console.error(error.message);
	process.exit(1);
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? process.cwd(),
		env: { ...process.env, ...options.env },
		shell: false,
		stdio: "inherit",
	});
	if (result.error)
		fail(`failed to execute: ${command} ${args.join(" ")}`, result.error);
	if (result.status !== 0) process.exit(result.status ?? 1);
}

fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(pkgDir, { recursive: true });

run(
	"node",
	[
		cargoRun,
		"--copy",
		"wasm32-wasip1/release/dispatch_surface.wasm",
		path.resolve(distDir, "dispatch_surface.wasm"),
		"component",
		"build",
		"--target",
		"wasm32-wasip1",
		"--release",
	],
	{
		cwd: crateDir,
	},
);

const requireJco = process.env.DISPATCH_SURFACE_REQUIRE_JCO === "1";
const jcoCheck = spawnSync(
	"pnpm",
	[
		"--dir",
		path.resolve(repoRoot, "packages", "heartwood"),
		"exec",
		"jco",
		"--version",
	],
	{ stdio: "ignore", shell: false },
);

if (jcoCheck.status === 0) {
	run(
		"pnpm",
		[
			"--dir",
			path.resolve(repoRoot, "packages", "heartwood"),
			"exec",
			"jco",
			"transpile",
			wasmPath,
			"-o",
			pkgDir,
			"--name",
			"dispatch_surface",
			"--import-bindings",
			"hybrid",
		],
		{
			cwd: crateDir,
		},
	);
	console.log("dispatch-surface-rs: transpile completed (pkg/).");
} else if (requireJco) {
	fail(
		"jco unavailable but DISPATCH_SURFACE_REQUIRE_JCO=1 requested native artifact generation.",
	);
} else {
	console.warn(
		"jco not available in this environment; skipped JS/Javascript component transpile.\n" +
			"Install @bytecodealliance/jco (or run from a context where @refarm.dev/dispatch-surface peers can access it)",
	);
}
