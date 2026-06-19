#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function usage() {
	console.error("Usage: node scripts/ci/check-rust-substrate.mjs [--json]");
}

function run(command, args = []) {
	try {
		return {
			ok: true,
			stdout: execFileSync(command, args, { encoding: "utf8", windowsHide: true }).trim(),
		};
	} catch (error) {
		if (error.status === 0) {
			return {
				ok: true,
				stdout: error.stdout?.toString().trim() ?? "",
				stderr: error.stderr?.toString().trim() ?? "",
			};
		}
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

export function checkRustSubstrate() {
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
	const explicitMsvcLinker =
		process.platform === "win32"
			? (process.env.CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER ?? null)
			: null;
	const explicitMsvcLinkerOk =
		Boolean(explicitMsvcLinker) &&
		/\\link\.exe$/i.test(explicitMsvcLinker) &&
		existsSync(explicitMsvcLinker);
	if (process.platform === "win32" && rustcHost?.endsWith("-msvc")) {
		checks.push({
			id: "msvc_cl",
			ok: Boolean(compiler),
			path: compiler,
		});
		checks.push({
			id: "msvc_link",
			ok: explicitMsvcLinkerOk || (Boolean(linker) && !/\\Git\\usr\\bin\\link\.exe$/i.test(linker)),
			path: explicitMsvcLinkerOk ? explicitMsvcLinker : linker,
		});
	}

	const missing = checks.filter((check) => !check.ok);
	const needsMsvc =
		process.platform === "win32" &&
		rustcHost?.endsWith("-msvc") &&
		(!compiler || (!explicitMsvcLinkerOk && linker?.includes("\\Git\\usr\\bin\\link.exe")));
	const recommendations = [];
	if (!hasWasiTarget) {
		recommendations.push({
			diagnostic: "rust-substrate:missing-wasi-target",
			severity: "failure",
			summary: "The Rust target wasm32-wasip1 is required for Refarm WASM plugin builds.",
			action: "rustup target add wasm32-wasip1",
			command: "rustup target add wasm32-wasip1",
			target: "wasm32-wasip1",
		});
	}
	if (process.platform === "win32" && rustcHost?.endsWith("-msvc") && !compiler) {
		recommendations.push({
			diagnostic: "rust-substrate:missing-msvc-build-tools",
			severity: "failure",
			summary: "The Windows MSVC Rust toolchain requires Visual Studio C++ build tools.",
			action: "Install Visual Studio Build Tools with the C++ build tools workload.",
			target: "cl.exe",
		});
	}
	if (
		process.platform === "win32" &&
		rustcHost?.endsWith("-msvc") &&
		!explicitMsvcLinkerOk &&
		linker?.includes("\\Git\\usr\\bin\\link.exe")
	) {
		recommendations.push({
			diagnostic: "rust-substrate:wrong-msvc-linker",
			severity: "failure",
			summary: "The Rust MSVC linker resolves to Git's Unix-style link.exe instead of the MSVC linker.",
			action: "Open a Developer PowerShell for VS, set CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER, or put the MSVC linker before Git usr/bin in PATH.",
			target: linker,
		});
	}
	if (!hasCargoComponent) {
		recommendations.push({
			diagnostic: "rust-substrate:missing-cargo-component",
			severity: "failure",
			summary: "cargo-component is required to build Refarm component-model WASM packages.",
			action: "cargo install cargo-component --locked",
			command: needsMsvc ? undefined : "cargo install cargo-component --locked",
			target: "cargo component",
		});
	}

	const nextActions = recommendations.map((recommendation) => recommendation.action);
	const nextCommands = recommendations
		.map((recommendation) => recommendation.command)
		.filter((command) => typeof command === "string" && command.length > 0);
	return {
		ok: missing.length === 0,
		platform: process.platform,
		rustcHost,
		checks,
		missing,
		recommendations,
		command: "rust-substrate",
		operation: "check",
		nextAction: nextActions[0] ?? null,
		nextActions,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
	};
}

function main() {
	const json = process.argv.includes("--json");
	const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--json");
	if (unknownArgs.length > 0) {
		usage();
		process.exit(1);
	}

	const result = checkRustSubstrate();
	if (json) {
		console.log(JSON.stringify(result, null, 2));
	} else if (result.ok) {
		console.log("rust-substrate: OK");
	} else {
		console.error("rust-substrate: missing Rust/WASM execution substrate");
		for (const check of result.missing) {
			const suffix = check.path || check.detail ? ` (${check.path ?? check.detail})` : "";
			console.error(`  missing: ${check.id}${suffix}`);
		}
		for (const recommendation of result.recommendations) {
			console.error(`  next: ${recommendation.action}`);
		}
	}

	process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	main();
}
