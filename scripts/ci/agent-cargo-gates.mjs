#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const TRACTOR_DIR = path.join(ROOT, "packages", "tractor");
const PI_AGENT_DIR = path.join(ROOT, "packages", "pi-agent");
const plan = process.argv.includes("--plan");
const mode = process.argv.slice(2).find((arg) => !arg.startsWith("--"));

function usage() {
	console.error(
		"Usage: node scripts/ci/agent-cargo-gates.mjs [--plan] <lsp:check|lsp:harness|lsp:harness:build|streaming:check|streaming:harness|streaming:harness:build>",
	);
}

function step(cwd, command, args, options = {}) {
	return {
		cwd,
		command,
		args,
		timeoutMs: options.timeoutMs,
		display: `${command} ${args.join(" ")}`,
	};
}

function cargo(cwd, args, options = {}) {
	return step(cwd, "cargo", args, options);
}

function cargoComponent(cwd, args) {
	return step(cwd, "cargo", ["component", ...args]);
}

const LSP_HARNESS_STEPS = [
	cargo(
		TRACTOR_DIR,
		[
			"test",
			"--test",
			"pi_agent_harness",
			"harness_tool_use_dispatched_and_result_fed_back",
			"--",
			"--ignored",
			"--test-threads=1",
			"--nocapture",
		],
		{ timeoutMs: 90_000 },
	),
	cargo(
		TRACTOR_DIR,
		[
			"test",
			"--test",
			"pi_agent_harness",
			"harness_find_references_tool_reads_lsp_locations",
			"--",
			"--ignored",
			"--test-threads=1",
			"--nocapture",
		],
		{ timeoutMs: 90_000 },
	),
	cargo(
		TRACTOR_DIR,
		[
			"test",
			"--test",
			"pi_agent_harness",
			"harness_rename_symbol_tool_updates_workspace_file_via_lsp",
			"--",
			"--ignored",
			"--test-threads=1",
			"--nocapture",
		],
		{ timeoutMs: 90_000 },
	),
];

const STREAMING_HARNESS_STEPS = [
	cargo(TRACTOR_DIR, [
		"test",
		"--test",
		"pi_agent_harness",
		"harness_streaming",
		"--",
		"--ignored",
		"--test-threads=1",
	]),
];

function stepsForMode(selectedMode) {
	switch (selectedMode) {
		case "lsp:check":
			return [
				cargo(TRACTOR_DIR, ["test", "--lib", "lsp_bridge", "--quiet"]),
				cargo(TRACTOR_DIR, ["test", "--test", "pi_agent_harness", "--no-run"]),
			];
		case "lsp:harness":
			return LSP_HARNESS_STEPS;
		case "lsp:harness:build":
			return [
				cargoComponent(PI_AGENT_DIR, ["build", "--release"]),
				...LSP_HARNESS_STEPS,
			];
		case "streaming:check":
			return [
				cargo(PI_AGENT_DIR, ["check", "--target", "wasm32-wasip1", "--quiet"]),
				cargo(PI_AGENT_DIR, ["test", "--lib", "streaming_config", "--quiet"]),
				cargo(PI_AGENT_DIR, [
					"test",
					"--lib",
					"provider_runtime_stream_body_gate",
					"--quiet",
				]),
				cargo(TRACTOR_DIR, ["check", "--quiet"]),
				cargo(TRACTOR_DIR, [
					"test",
					"--lib",
					"read_sse_data_events_limited",
					"--quiet",
				]),
				cargo(TRACTOR_DIR, [
					"test",
					"--lib",
					"complete_http_stream",
					"--quiet",
				]),
				cargo(TRACTOR_DIR, [
					"test",
					"--lib",
					"store_stream_agent_response_chunks_from_reader",
					"--quiet",
				]),
			];
		case "streaming:harness":
			return STREAMING_HARNESS_STEPS;
		case "streaming:harness:build":
			return [
				cargoComponent(PI_AGENT_DIR, ["build", "--release", "-p", "pi-agent"]),
				...STREAMING_HARNESS_STEPS,
			];
		default:
			throw new Error(`Unknown agent cargo gate mode: ${selectedMode}`);
	}
}

function runStep(item) {
	return new Promise((resolve, reject) => {
		const child = spawn(item.command, item.args, {
			cwd: item.cwd,
			env: process.env,
			stdio: "inherit",
		});
		let timer;
		if (item.timeoutMs) {
			timer = setTimeout(() => {
				child.kill("SIGTERM");
				reject(new Error(`${item.display} timed out after ${item.timeoutMs}ms`));
			}, item.timeoutMs);
		}
		child.on("error", reject);
		child.on("exit", (code) => {
			if (timer) clearTimeout(timer);
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${item.display} exited with code ${code}`));
		});
	});
}

if (!mode) {
	usage();
	process.exit(1);
}

let steps;
try {
	steps = stepsForMode(mode);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	usage();
	process.exit(1);
}

for (const item of steps) {
	if (plan) {
		console.log(`${path.relative(ROOT, item.cwd)}: ${item.display}`);
		continue;
	}
	console.log(`\n[agent-cargo-gates] ${path.relative(ROOT, item.cwd)}: ${item.display}`);
	await runStep(item);
}
