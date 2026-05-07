import test from "node:test";
import assert from "node:assert/strict";
import {
	decideProfile,
	isRefarmActionReadinessFile,
	isRefarmTreeFile,
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

test("detects tree timeline files", () => {
	assert.equal(isRefarmTreeFile("apps/refarm/src/commands/tree.ts"), true);
	assert.equal(
		isRefarmTreeFile("apps/farmhand/src/transports/sessions.test.ts"),
		true,
	);
	assert.equal(
		isRefarmTreeFile("apps/refarm/src/commands/action-affordances.ts"),
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

test("routes tree-only deltas to focused tree lane", () => {
	assert.equal(
		decideProfile([
			"apps/refarm/src/commands/tree.ts",
			"apps/refarm/test/commands/tree.test.ts",
			"apps/farmhand/src/transports/sessions.test.ts",
			"docs/REFARM_TREE_PRIMITIVE.md",
		]).profile,
		"tree",
	);
});

test("keeps smoke governance changes on ci lane", () => {
	assert.equal(
		decideProfile(["scripts/ci/smoke-refarm-host-auto.mjs"]).profile,
		"ci",
	);
});

test("skips docs-only deltas", () => {
	assert.equal(decideProfile(["docs/REFARM_CLI_DISTRO.md"]).profile, "skip");
});

test("routes mixed action and tree source deltas to dev lane", () => {
	assert.equal(
		decideProfile([
			"apps/refarm/src/commands/action-affordances.ts",
			"apps/refarm/src/commands/tree.ts",
		]).profile,
		"dev",
	);
});

test("routes generic host tests to quick lane", () => {
	assert.equal(
		decideProfile(["apps/refarm/test/commands/program.test.ts"]).profile,
		"quick",
	);
});
