#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { checkRustSubstrate } from "./check-rust-substrate.mjs";

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

test("check-rust-substrate treats rustup version panic as a warning", () => {
	const result = checkRustSubstrate({
		runCommand(command, args = []) {
			const key = `${command} ${args.join(" ")}`;
			if (key === "rustc -vV") {
				return {
					ok: true,
					stdout: "rustc 1.99.0\nhost: x86_64-unknown-linux-gnu",
				};
			}
			if (key === "cargo --list") {
				return {
					ok: true,
					stdout: "Installed Commands:\n    component\n    test",
				};
			}
			if (key === "rustup target list --installed") {
				return { ok: true, stdout: "wasm32-wasip1" };
			}
			if (key === "rustup --version") {
				return {
					ok: false,
					stdout: "rustup 1.29.0",
					stderr: "thread 'main' panicked",
				};
			}
			return { ok: false, stdout: "", stderr: `unexpected: ${key}` };
		},
	});

	assert.equal(result.ok, true);
	assert.deepEqual(result.missing, []);
	assert.deepEqual(result.warnings, ["rustup_version"]);
	assert.equal(result.warningCount, 1);
	assert.equal(result.nextAction, null);
	assert.deepEqual(result.nextActions, []);
	assert.equal(
		result.recommendations.at(-1)?.diagnostic,
		"rust-substrate:rustup-version-probe",
	);
});
