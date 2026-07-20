import assert from "node:assert/strict";
import { test } from "node:test";

import { buildVerifyPlan, turboArgsFor } from "./verify-changed.mjs";

test("no args → diff against default base, all three phases", () => {
	const plan = buildVerifyPlan([]);
	assert.deepEqual(plan.filters, ["[origin/develop]..."]);
	assert.deepEqual(
		plan.phases.map((p) => p.task),
		["type-check", "lint", "test"],
	);
	assert.equal(plan.packages.length, 0);
});

test("explicit packages → each becomes a `pkg...` (package + dependents) filter", () => {
	const plan = buildVerifyPlan(["@refarm.dev/capabilities", "@refarm.dev/tractor"]);
	assert.deepEqual(plan.filters, ["@refarm.dev/capabilities...", "@refarm.dev/tractor..."]);
	assert.deepEqual(plan.packages, ["@refarm.dev/capabilities", "@refarm.dev/tractor"]);
});

test("--base overrides the diff ref", () => {
	const plan = buildVerifyPlan(["--base", "main"]);
	assert.deepEqual(plan.filters, ["[main]..."]);
	assert.equal(plan.base, "main");
});

test("--no-tests drops the test phase", () => {
	const plan = buildVerifyPlan(["--no-tests"]);
	assert.deepEqual(
		plan.phases.map((p) => p.task),
		["type-check", "lint"],
	);
});

test("type-check runs at higher concurrency than the Rust-heavy lint/test", () => {
	const plan = buildVerifyPlan([]);
	const byTask = Object.fromEntries(plan.phases.map((p) => [p.task, p.concurrency]));
	assert.ok(byTask["type-check"] > byTask["lint"], "type-check should out-parallel lint");
	assert.equal(byTask["lint"], byTask["test"]); // both may compile Rust → same conservative cap
});

test("turboArgsFor builds a timeout-free, errors-only turbo invocation", () => {
	const [typeCheck] = buildVerifyPlan([]).phases;
	const args = turboArgsFor(typeCheck, ["[origin/develop]..."]);
	assert.deepEqual(args, [
		"turbo",
		"run",
		"type-check",
		"--filter=[origin/develop]...",
		"--concurrency=4",
		"--output-logs=errors-only",
		"--continue",
	]);
});
