#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { findDerivedArtifactOwnershipIssues } from "./check-derived-artifact-ownership.mjs";
import { checkNodeSubstrate } from "./check-node-substrate.mjs";
import { checkRustSubstrate } from "./check-rust-substrate.mjs";

function usage() {
	console.error("Usage: node scripts/ci/check-environment-substrate.mjs [--json]");
}

const json = process.argv.includes("--json");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--json");
if (unknownArgs.length > 0) {
	usage();
	process.exit(1);
}

function displayCommand(command, args = []) {
	return [command, ...args].join(" ");
}

function compactError(value, limit = 1600) {
	if (!value) return value;
	return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function windowsShellCommand(command, args = []) {
	if (process.platform !== "win32") {
		return { command, args, display: displayCommand(command, args) };
	}
	return {
		command: "cmd.exe",
		args: ["/d", "/s", "/c", command, ...args],
		display: displayCommand(command, args),
		logicalCommand: command,
		logicalArgs: args,
	};
}

function run(command, args = [], options = {}) {
	const result = spawnSync(command, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	return {
		command,
		args,
		display: options.display ?? displayCommand(command, args),
		exitCode: result.status ?? 1,
		ok: result.status === 0,
		stdout: result.stdout?.trim() ?? "",
		stderr: result.stderr?.trim() ?? "",
		error: result.error?.message,
	};
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

function compactImportedCheck(result, display) {
	return {
		ok: result.ok,
		exitCode: result.ok ? 0 : 1,
		display,
		stdout: "",
		stderr: "",
	};
}

function toolCheck(id, command, args = ["--version"], options = {}) {
	const result = run(command, args, options);
	const logicalCommand = options.logicalCommand ?? command;
	const logicalArgs = options.logicalArgs ?? args;
	return {
		id,
		kind: "tool",
		required: options.required !== false,
		ok: result.ok,
		command: logicalCommand,
		args: logicalArgs,
		display: result.display,
		version: result.ok ? result.stdout.split(/\r?\n/)[0] ?? "" : null,
		error: result.ok ? null : compactError(result.stderr || result.error || "command failed"),
	};
}

function toolCheckAlternatives(id, alternatives, options = {}) {
	const attempts = alternatives.map((alternative) =>
		toolCheck(id, alternative.command, alternative.args, { ...options, ...alternative }),
	);
	const passingAttempt = attempts.find((attempt) => attempt.ok);
	return {
		...(passingAttempt ?? attempts[0]),
		id,
		kind: "tool",
		required: options.required !== false,
		ok: Boolean(passingAttempt),
		command: passingAttempt?.command ?? attempts[0].command,
		args: passingAttempt?.args ?? attempts[0].args,
		display: passingAttempt?.display ?? attempts[0].display,
		attempts,
		version: passingAttempt?.version ?? null,
		error: passingAttempt
			? null
			: attempts.map((attempt) => `${attempt.display}: ${attempt.error}`).join("; "),
	};
}

function pnpmToolAlternatives(env = process.env) {
	const alternatives = [
		windowsShellCommand("pnpm", ["--version"]),
		windowsShellCommand("pnpm.cmd", ["--version"]),
		windowsShellCommand("corepack", ["pnpm", "--version"]),
	];

	if (process.platform === "win32" && env.PNPM_HOME) {
		const pnpmHome = env.PNPM_HOME;
		alternatives.push(
			windowsShellCommand(path.join(pnpmHome, "pnpm.cmd"), ["--version"]),
			windowsShellCommand(path.join(pnpmHome, "pnpm"), ["--version"]),
			windowsShellCommand(path.join(pnpmHome, "bin", "pnpm.cmd"), ["--version"]),
			windowsShellCommand(path.join(pnpmHome, "bin", "pnpm"), ["--version"]),
		);
	}

	return alternatives;
}

const nodeSubstrate = await checkNodeSubstrate();
const rustSubstrate = checkRustSubstrate();
const artifactOwnershipIssues = findDerivedArtifactOwnershipIssues();
const artifactOwnershipCheck = {
	id: "derived_artifact_ownership",
	kind: "workspace-artifacts",
	required: true,
	ok: artifactOwnershipIssues.length === 0,
	command: "pnpm run workspace:artifacts:ownership",
	issueCount: artifactOwnershipIssues.length,
	issues: artifactOwnershipIssues,
};

const tools = [
	toolCheck("tool_node", process.execPath, ["--version"]),
	toolCheckAlternatives("tool_pnpm", pnpmToolAlternatives()),
	toolCheck("tool_git", "git", ["--version"]),
	toolCheck("tool_gh", "gh", ["--version"]),
	toolCheck("tool_rustc", "rustc", ["-V"]),
	toolCheck("tool_cargo", "cargo", ["-V"]),
];
const diagnosticTools = [
	toolCheck("diagnostic_rustup_version", "rustup", ["--version"], { required: false }),
	toolCheck("diagnostic_wasm_tools", "wasm-tools", ["--version"], { required: false }),
	toolCheck("diagnostic_bash", "bash", ["--version"], { required: false }),
	toolCheck("diagnostic_jq", "jq", ["--version"], { required: false }),
	toolCheck("diagnostic_rg", "rg", ["--version"], { required: false }),
	toolCheck("diagnostic_fd", "fd", ["--version"], { required: false }),
	toolCheck("diagnostic_shellcheck", "shellcheck", ["--version"], { required: false }),
	toolCheck("diagnostic_shfmt", "shfmt", ["--version"], { required: false }),
	toolCheck("diagnostic_bwrap", "bwrap", ["--version"], { required: false }),
];

const checks = [
	{
		id: "node_substrate",
		kind: "substrate",
		ok: nodeSubstrate.ok === true,
		command: "node scripts/ci/check-node-substrate.mjs --json",
		exitCode: nodeSubstrate.ok ? 0 : 1,
	},
	{
		id: "rust_substrate",
		kind: "substrate",
		ok: rustSubstrate.ok === true,
		command: "node scripts/ci/check-rust-substrate.mjs --json",
		exitCode: rustSubstrate.ok ? 0 : 1,
	},
	artifactOwnershipCheck,
	...tools,
	...diagnosticTools,
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
	...(artifactOwnershipCheck.ok
		? []
		: [
			{
				diagnostic: "environment-substrate:derived-artifact-ownership",
				severity: "failure",
				summary: "Derived workspace artifacts are owned by another user or container.",
				action:
					"Run pnpm run workspace:artifacts:ownership, then clean only the reported ignored outputs in the environment that owns them.",
				target: "workspace-artifacts",
				issues: artifactOwnershipIssues,
			},
		]),
	...diagnosticTools
		.filter((check) => !check.ok)
		.map((check) => check.id === "diagnostic_rustup_version"
			? {
				diagnostic: "environment-substrate:rustup-version-probe",
				severity: "warning",
				summary: "rustup --version failed, but Rust target validation is handled by rust-substrate.",
				action: "Inspect rustup --version only if Rust diagnostics need the exact rustup manager version.",
				target: check.command,
			}
			: {
				diagnostic: `environment-substrate:missing-${check.id.replace(/^diagnostic_/, "")}`,
				severity: "warning",
				summary: `Diagnostic tool is not available: ${check.command}`,
				action: `Install or expose ${check.command} in PATH when this environment should support agent diagnostics.`,
				target: check.command,
			}),
];

const nextCommands = [
	...(Array.isArray(nodeSubstrate.nextCommands) ? nodeSubstrate.nextCommands : []),
	...(Array.isArray(rustSubstrate.nextCommands) ? rustSubstrate.nextCommands : []),
];
const blockingRecommendations = recommendations.filter(
	(recommendation) => recommendation.severity !== "warning" && recommendation.severity !== "info",
);
const nextActions = blockingRecommendations.map((recommendation) => recommendation.action);
const failedChecks = checks.filter((check) => check.required !== false && !check.ok);
const warningChecks = checks.filter((check) => check.required === false && !check.ok);

const result = {
	schemaVersion: 1,
	ok: failedChecks.length === 0,
	command: "environment-substrate",
	operation: "check",
	platform: process.platform,
	arch: process.arch,
	nodeVersion: process.version,
	checks,
	failedChecks,
	warningChecks,
	substrate: {
		node: nodeSubstrate,
		rust: rustSubstrate,
		tools,
		diagnosticTools,
	},
	processes: {
		nodeSubstrate: compactImportedCheck(
			nodeSubstrate,
			"node scripts/ci/check-node-substrate.mjs --json",
		),
		rustSubstrate: compactImportedCheck(
			rustSubstrate,
			"node scripts/ci/check-rust-substrate.mjs --json",
		),
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
