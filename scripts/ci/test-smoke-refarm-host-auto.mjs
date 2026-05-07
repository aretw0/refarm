import test from "node:test";
import assert from "node:assert/strict";
import {
	decideProfile,
	isRefarmActionReadinessFile,
	isRefarmTreeFile,
	isSmokeProfile,
	normalizeChangedFiles,
	resolveProfileScript,
} from "./smoke-refarm-host-auto.mjs";

test("normalizes changed files before routing", () => {
	assert.deepEqual(
		normalizeChangedFiles([
			"docs/REFARM_CLI_DISTRO.md",
			".pi/todos/d777f597.md",
			"apps/refarm/src/commands/status.ts",
			"docs/REFARM_CLI_DISTRO.md",
		]),
		["apps/refarm/src/commands/status.ts", "docs/REFARM_CLI_DISTRO.md"],
	);
});

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

test("maps profiles to npm scripts", () => {
	assert.equal(isSmokeProfile("skip"), true);
	assert.equal(isSmokeProfile("actions"), true);
	assert.equal(isSmokeProfile("tree"), true);
	assert.equal(isSmokeProfile("unknown"), false);
	assert.equal(resolveProfileScript("skip"), null);
	assert.equal(resolveProfileScript("actions"), "refarm:actions:verify");
	assert.equal(resolveProfileScript("tree"), "refarm:tree:verify");
	assert.equal(resolveProfileScript("quick"), "refarm:host:smoke:quick");
	assert.equal(resolveProfileScript("dev"), "refarm:host:smoke:dev");
	assert.equal(resolveProfileScript("ci"), "refarm:host:smoke:ci");
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
	assert.equal(decideProfile(["package.json"]).profile, "ci");
});

test("skips empty or docs-only deltas", () => {
	assert.equal(decideProfile([]).profile, "skip");
	assert.equal(decideProfile(["docs/REFARM_CLI_DISTRO.md"]).profile, "skip");
});

test("routes host source and CLI flow deltas to dev lane", () => {
	assert.equal(
		decideProfile(["apps/refarm/src/commands/status.ts"]).profile,
		"dev",
	);
	assert.equal(
		decideProfile(["scripts/ci/smoke-refarm-host-cli-flows.mjs"]).profile,
		"dev",
	);
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

test("routes shared execution-plan helper changes to dev lane", () => {
	assert.equal(
		decideProfile(["apps/refarm/src/commands/execution-plan.ts"]).profile,
		"dev",
	);
});

test("routes generic host tests to quick lane", () => {
	assert.equal(
		decideProfile(["apps/refarm/test/commands/program.test.ts"]).profile,
		"quick",
	);
});
