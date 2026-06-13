#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptPath = "scripts/ci/check-environment-substrate.mjs";

function runCheck(args = ["--json"]) {
	return spawnSync(process.execPath, [scriptPath, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
}

test("environment substrate check emits a stable JSON handoff envelope", () => {
	const result = runCheck();
	assert.equal(result.stderr, "");

	const output = JSON.parse(result.stdout);
	assert.equal(output.command, "environment-substrate");
	assert.equal(output.operation, "check");
	assert.equal(typeof output.ok, "boolean");
	assert.equal(typeof output.platform, "string");
	assert.equal(typeof output.arch, "string");
	assert.equal(typeof output.nodeVersion, "string");
	assert.ok(Array.isArray(output.checks));
	assert.ok(Array.isArray(output.failedChecks));
	assert.ok(Array.isArray(output.recommendations));
	assert.ok(Array.isArray(output.nextActions));
	assert.ok(Array.isArray(output.nextCommands));
	assert.equal(typeof output.substrate.node.ok, "boolean");
	assert.equal(typeof output.substrate.rust.ok, "boolean");
	assert.ok(output.checks.some((check) => check.id === "node_substrate"));
	assert.ok(output.checks.some((check) => check.id === "rust_substrate"));
	assert.ok(output.checks.some((check) => check.id === "tool_node"));
});

test("environment substrate check rejects unknown arguments", () => {
	const result = runCheck(["--unknown"]);
	assert.notEqual(result.status, 0);
	assert.equal(result.stdout, "");
	assert.match(result.stderr, /Usage: node scripts\/ci\/check-environment-substrate\.mjs \[--json\]/);
});

