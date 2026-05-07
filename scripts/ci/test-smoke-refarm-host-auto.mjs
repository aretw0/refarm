import test from "node:test";
import assert from "node:assert/strict";
import {
	decideProfile,
	isRefarmActionReadinessFile,
} from "./smoke-refarm-host-auto.mjs";

test("detects action-readiness files", () => {
	assert.equal(
		isRefarmActionReadinessFile(
			"apps/refarm/src/commands/action-affordances.ts",
		),
		true,
	);
	assert.equal(
		isRefarmActionReadinessFile(
			"apps/refarm/test/fixtures/status-no-actions.json",
		),
		true,
	);
	assert.equal(
		isRefarmActionReadinessFile("apps/refarm/src/commands/tree.ts"),
		false,
	);
});

test("routes action-readiness-only deltas to focused actions lane", () => {
	assert.equal(
		decideProfile([
			"apps/refarm/src/commands/action-affordances.ts",
			"apps/refarm/test/fixtures/status-no-actions.json",
			"docs/REFARM_ACTION_READINESS_COOKBOOK.md",
		]).profile,
		"actions",
	);
});

test("keeps smoke governance changes on ci lane", () => {
	assert.equal(
		decideProfile(["scripts/ci/smoke-refarm-host-auto.mjs"]).profile,
		"ci",
	);
});

test("routes generic host tests to quick lane", () => {
	assert.equal(
		decideProfile(["apps/refarm/test/commands/program.test.ts"]).profile,
		"quick",
	);
});
