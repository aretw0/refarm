#!/usr/bin/env node
import { execFileSync } from "node:child_process";

function usage() {
	console.error("Usage: node scripts/ci/check-rust-substrate.mjs [--json]");
}

const json = process.argv.includes("--json");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--json");
if (unknownArgs.length > 0) {
	usage();
	process.exit(1);
}

function run(command, args = []) {
	try {
		return {
			ok: true,
			stdout: execFileSync(command, args, { encoding: "utf8", windowsHide: true }).trim(),
		};
	} catch (error) {
		return {
			ok: false,
			stdout: error.stdout?.toString().trim() ?? "",
			stderr: error.stderr?.toString().trim() ?? error.message,
		};
	}
}

function stripAnsi(value) {
	return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function commandSource(command) {
	const powershell = process.env.ComSpec ? "powershell.exe" : "pwsh";
	const result = run(powershell, [
		"-NoProfile",
		"-Command",
		`(Get-Command ${command} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)`,
	]);
	return result.ok && result.stdout ? result.stdout : null;
}

const rustc = run("rustc", ["-vV"]);
const cargoList = run("cargo", ["--list"]);
const rustupTargets = run("rustup", ["target", "list", "--installed"]);

const rustcHost = rustc.stdout.match(/^host:\s*(.+)$/m)?.[1] ?? null;
const installedTargets = rustupTargets.stdout.split(/\r?\n/).filter(Boolean);
const cargoCommands = stripAnsi(cargoList.stdout).split(/\r?\n/).map((line) => line.trim());
const hasCargoComponent = cargoCommands.some((line) => line === "component" || line.startsWith("component "));
const hasWasiTarget = installedTargets.includes("wasm32-wasip1");

const checks = [
	{ id: "rustc", ok: rustc.ok, detail: rustcHost },
	{ id: "cargo", ok: cargoList.ok },
	{ id: "rustup_targets", ok: rustupTargets.ok },
	{ id: "target_wasm32_wasip1", ok: hasWasiTarget },
	{ id: "cargo_component", ok: hasCargoComponent },
];

const linker = process.platform === "win32" ? commandSource("link.exe") : null;
const compiler = process.platform === "win32" ? commandSource("cl.exe") : null;
if (process.platform === "win32" && rustcHost?.endsWith("-msvc")) {
	checks.push({
		id: "msvc_cl",
		ok: Boolean(compiler),
		path: compiler,
	});
	checks.push({
		id: "msvc_link",
		ok: Boolean(linker) && !/\\Git\\usr\\bin\\link\.exe$/i.test(linker),
		path: linker,
	});
}

const missing = checks.filter((check) => !check.ok);
const recommendations = [];
if (!hasWasiTarget) recommendations.push("rustup target add wasm32-wasip1");
if (process.platform === "win32" && rustcHost?.endsWith("-msvc") && !compiler) {
	recommendations.push("Install Visual Studio Build Tools with the C++ build tools workload.");
}
if (process.platform === "win32" && rustcHost?.endsWith("-msvc") && linker?.includes("\\Git\\usr\\bin\\link.exe")) {
	recommendations.push("Open a Developer PowerShell for VS or put the MSVC linker before Git usr/bin in PATH.");
}
if (!hasCargoComponent) recommendations.push("cargo install cargo-component --locked");

const primaryNextCommand = recommendations[0] ?? null;
const result = {
	ok: missing.length === 0,
	platform: process.platform,
	rustcHost,
	checks,
	missing,
	recommendations,
	command: "rust-substrate",
	operation: "check",
	nextAction: primaryNextCommand,
	nextActions: recommendations,
	nextCommand: primaryNextCommand,
	nextCommands: recommendations,
};

if (json) {
	console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
	console.log("rust-substrate: OK");
} else {
	console.error("rust-substrate: missing Rust/WASM execution substrate");
	for (const check of missing) {
		const suffix = check.path || check.detail ? ` (${check.path ?? check.detail})` : "";
		console.error(`  missing: ${check.id}${suffix}`);
	}
	for (const recommendation of recommendations) {
		console.error(`  next: ${recommendation}`);
	}
}

process.exit(result.ok ? 0 : 1);
