#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptPath = "scripts/ci/check-environment-substrate.mjs";

function runCheck(args = ["--json"], env = {}) {
	return spawnSync(process.execPath, [scriptPath, ...args], {
		encoding: "utf8",
		env: { ...process.env, ...env },
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
}

test("environment substrate check emits a stable JSON handoff envelope", () => {
	const result = runCheck();
	assert.equal(result.stderr, "");

	const output = JSON.parse(result.stdout);
	assert.equal(output.schemaVersion, 1);
	assert.equal(output.command, "environment-substrate");
	assert.equal(output.operation, "check");
	assert.equal(typeof output.ok, "boolean");
	assert.equal(typeof output.platform, "string");
	assert.equal(typeof output.arch, "string");
	assert.equal(typeof output.nodeVersion, "string");
	assert.ok(Array.isArray(output.checks));
	assert.ok(Array.isArray(output.failedChecks));
	assert.ok(Array.isArray(output.warningChecks));
	assert.ok(Array.isArray(output.recommendations));
	assert.ok(Array.isArray(output.nextActions));
	assert.ok(Array.isArray(output.nextCommands));
	assert.equal(typeof output.substrate.node.ok, "boolean");
	assert.equal(typeof output.substrate.rust.ok, "boolean");
	assert.ok(output.checks.some((check) => check.id === "node_substrate"));
	assert.ok(output.checks.some((check) => check.id === "rust_substrate"));
	assert.ok(output.checks.some((check) =>
		check.id === "derived_artifact_ownership" &&
		check.kind === "workspace-artifacts" &&
		check.required === true &&
		check.command === "pnpm run workspace:artifacts:ownership",
	));
	assert.ok(output.checks.some((check) => check.id === "tool_node" && check.required === true));
	assert.ok(output.checks.some((check) =>
		check.id === "tool_pnpm" &&
		check.required === true &&
		Array.isArray(check.attempts) &&
		check.attempts.some((attempt) => attempt.command === "corepack"),
	));
	assert.ok(output.checks.some((check) => check.id === "diagnostic_wasm_tools" && check.required === false));
	assert.ok(output.checks.some((check) =>
		check.id === "diagnostic_rustup_version" &&
		check.required === false,
	));
	assert.ok(output.checks.some((check) => check.id === "diagnostic_jq" && check.required === false));
});

test("environment substrate check keeps optional diagnostics non-blocking", () => {
	const result = runCheck();
	const output = JSON.parse(result.stdout);

	for (const check of output.warningChecks) {
		assert.equal(check.required, false);
	}
	assert.equal(
		output.failedChecks.some((check) => check.required === false),
		false,
	);
	assert.equal(
		output.failedChecks.some((check) => check.id === "diagnostic_rustup_version"),
		false,
	);
	assert.equal(
		output.nextActions.some((action) => /agent diagnostics/.test(action)),
		false,
	);
});

test("environment substrate check reports missing tools instead of crashing", () => {
	const result = runCheck(["--json"], {
		PATH: "",
		Path: "",
		REFARM_NODE_SUBSTRATE_PLATFORM: process.platform,
	});

	assert.notEqual(result.status, 0);
	assert.doesNotMatch(result.stderr, /TypeError/);

	const output = JSON.parse(result.stdout);
	assert.equal(output.schemaVersion, 1);
	assert.equal(output.ok, false);
	assert.ok(output.failedChecks.length > 0);
	assert.ok(output.recommendations.some((recommendation) =>
		recommendation.diagnostic.startsWith("environment-substrate:missing-"),
	));
});

test("environment substrate check rejects unknown arguments", () => {
	const result = runCheck(["--unknown"]);
	assert.notEqual(result.status, 0);
	assert.equal(result.stdout, "");
	assert.match(result.stderr, /Usage: node scripts\/ci\/check-environment-substrate\.mjs \[--json\]/);
});
