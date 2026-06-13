#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("check-rust-substrate emits structured handoff fields", () => {
	let stdout = "";
	try {
		stdout = execFileSync(
			process.execPath,
			["scripts/ci/check-rust-substrate.mjs", "--json"],
			{ encoding: "utf8", windowsHide: true },
		);
	} catch (error) {
		stdout = error.stdout?.toString() ?? "";
	}

	const output = JSON.parse(stdout);
	assert.equal(output.command, "rust-substrate");
	assert.equal(output.operation, "check");
	assert.ok(Array.isArray(output.recommendations));
	assert.ok(Array.isArray(output.nextActions));
	assert.ok(Array.isArray(output.nextCommands));

	for (const recommendation of output.recommendations) {
		assert.equal(typeof recommendation.diagnostic, "string");
		assert.equal(typeof recommendation.severity, "string");
		assert.equal(typeof recommendation.summary, "string");
		assert.equal(typeof recommendation.action, "string");
	}

	const commandRecommendations = output.recommendations
		.map((recommendation) => recommendation.command)
		.filter((command) => typeof command === "string" && command.length > 0);
	assert.deepEqual(output.nextCommands, commandRecommendations);
	assert.equal(output.nextCommand, commandRecommendations[0] ?? null);
});
