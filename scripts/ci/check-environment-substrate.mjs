#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function usage() {
	console.error("Usage: node scripts/ci/check-environment-substrate.mjs [--json]");
}

const json = process.argv.includes("--json");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--json");
if (unknownArgs.length > 0) {
	usage();
	process.exit(1);
}

function run(command, args = []) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	return {
		command,
		args,
		display: [command, ...args].join(" "),
		exitCode: result.status ?? 1,
		ok: result.status === 0,
		stdout: result.stdout.trim(),
		stderr: result.stderr.trim(),
		error: result.error?.message,
	};
}

function parseJsonRun(result) {
	try {
		return JSON.parse(result.stdout);
	} catch {
		return {
			ok: false,
			command: result.command,
			operation: "check",
			parseError: true,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	}
}

function normalizeRecommendation(source, recommendation) {
	if (typeof recommendation === "string") {
		return {
			diagnostic: `${source}:recommendation`,
			severity: "failure",
			summary: recommendation,
			action: recommendation,
		};
	}
	return {
		source,
		...recommendation,
	};
}

function compactOutput(result) {
	return {
		ok: result.ok,
		exitCode: result.exitCode,
		display: result.display,
		stdout: result.stdout.slice(0, 4000),
		stderr: result.stderr.slice(0, 4000),
		error: result.error,
	};
}

function toolCheck(id, command, args = ["--version"]) {
	const result = run(command, args);
	return {
		id,
		kind: "tool",
		ok: result.ok,
		command,
		args,
		version: result.ok ? result.stdout.split(/\r?\n/)[0] ?? "" : null,
		error: result.ok ? null : result.stderr || result.error || "command failed",
	};
}

const nodeRun = run(process.execPath, ["scripts/ci/check-node-substrate.mjs", "--json"]);
const rustRun = run(process.execPath, ["scripts/ci/check-rust-substrate.mjs", "--json"]);
const nodeSubstrate = parseJsonRun(nodeRun);
const rustSubstrate = parseJsonRun(rustRun);

const tools = [
	toolCheck("tool_node", process.execPath, ["--version"]),
	toolCheck("tool_pnpm", "pnpm", ["--version"]),
	toolCheck("tool_git", "git", ["--version"]),
	toolCheck("tool_gh", "gh", ["--version"]),
	toolCheck("tool_rustc", "rustc", ["-V"]),
	toolCheck("tool_cargo", "cargo", ["-V"]),
	toolCheck("tool_rustup", "rustup", ["--version"]),
	toolCheck("tool_wasm_tools", "wasm-tools", ["--version"]),
];

const checks = [
	{
		id: "node_substrate",
		kind: "substrate",
		ok: nodeSubstrate.ok === true,
		command: "node scripts/ci/check-node-substrate.mjs --json",
		exitCode: nodeRun.exitCode,
	},
	{
		id: "rust_substrate",
		kind: "substrate",
		ok: rustSubstrate.ok === true,
		command: "node scripts/ci/check-rust-substrate.mjs --json",
		exitCode: rustRun.exitCode,
	},
	...tools,
];

const recommendations = [
	...(Array.isArray(nodeSubstrate.recommendations)
		? nodeSubstrate.recommendations.map((recommendation) =>
			normalizeRecommendation("node-substrate", recommendation),
		)
		: []),
	...(Array.isArray(rustSubstrate.recommendations)
		? rustSubstrate.recommendations.map((recommendation) =>
			normalizeRecommendation("rust-substrate", recommendation),
		)
		: []),
	...tools
		.filter((check) => !check.ok)
		.map((check) => ({
			diagnostic: `environment-substrate:missing-${check.id.replace(/^tool_/, "")}`,
			severity: "failure",
			summary: `Required tool is not available: ${check.command}`,
			action: `Install or expose ${check.command} in PATH for this environment.`,
			target: check.command,
		})),
];

const nextCommands = [
	...(Array.isArray(nodeSubstrate.nextCommands) ? nodeSubstrate.nextCommands : []),
	...(Array.isArray(rustSubstrate.nextCommands) ? rustSubstrate.nextCommands : []),
];
const nextActions = recommendations.map((recommendation) => recommendation.action);
const failedChecks = checks.filter((check) => !check.ok);

const result = {
	ok: failedChecks.length === 0,
	command: "environment-substrate",
	operation: "check",
	platform: process.platform,
	arch: process.arch,
	nodeVersion: process.version,
	checks,
	failedChecks,
	substrate: {
		node: nodeSubstrate,
		rust: rustSubstrate,
		tools,
	},
	processes: {
		nodeSubstrate: compactOutput(nodeRun),
		rustSubstrate: compactOutput(rustRun),
	},
	recommendations,
	nextAction: nextActions[0] ?? null,
	nextActions,
	nextCommand: nextCommands[0] ?? null,
	nextCommands,
};

if (json) {
	console.log(JSON.stringify(result, null, 2));
} else if (result.ok) {
	console.log("environment-substrate: OK");
} else {
	console.error("environment-substrate: missing runtime substrate");
	for (const check of failedChecks) {
		console.error(`  failed: ${check.id}`);
	}
	if (result.nextAction) {
		console.error(`  next: ${result.nextAction}`);
	}
	if (result.nextCommand) {
		console.error(`  command: ${result.nextCommand}`);
	}
}

process.exit(result.ok ? 0 : 1);

