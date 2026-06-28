import assert from "node:assert/strict";
import test from "node:test";
import {
	buildPlan,
	parseReleaseReadinessArgs,
	serializePlan,
} from "./release-readiness.mjs";

test("prints an ordered release readiness plan", () => {
	const output = buildPlan()
		.map((step) => `${step.id}: ${step.display}`)
		.join("\n");

	assert.match(output, /operator-readiness: .*refarm:check:gate/);
	assert.match(output, /release-policy: .*release:policy:check/);
	assert.match(output, /node-substrate: .*node-substrate:check/);
	assert.match(output, /rust-substrate: .*rust-substrate:check/);
	assert.match(output, /environment-substrate: .*environment-substrate:check/);
	assert.match(output, /source-ownership: .*workspace:source:ownership/);
	assert.match(output, /derived-artifacts: .*workspace:artifacts:ownership/);
	assert.match(output, /test-runner-contracts: .*test-runner:contracts/);
	assert.match(output, /github-actions-pins: .*actions:pins/);
	assert.match(output, /github-actions-contracts: .*actions:contracts/);
	assert.match(output, /codemod-registry: .*codemods:check/);
	assert.match(output, /audience-boundary: .*audience:boundary:test/);
	assert.match(output, /reference-driver: .*reference-driver:smoke/);
	assert.match(output, /publish-dry-run: .*release:check/);
});

test("prints structured release readiness metadata", () => {
	const plan = buildPlan();
	const payload = {
		ok: true,
		command: "release-readiness",
		mode: "plan",
		steps: serializePlan(plan),
	};

	assert.equal(payload.ok, true);
	assert.equal(payload.command, "release-readiness");
	assert.equal(payload.mode, "plan");
	assert.deepEqual(
		payload.steps.map((step) => step.id),
		[
			"operator-readiness",
			"release-policy",
			"node-substrate",
			"rust-substrate",
			"environment-substrate",
			"source-ownership",
			"derived-artifacts",
			"test-runner-contracts",
			"github-actions-pins",
			"github-actions-contracts",
			"codemod-registry",
			"audience-boundary",
			"reference-driver",
			"publish-dry-run",
		],
	);
});

test("accepts package-manager argument separators before json flags", () => {
	const parsed = parseReleaseReadinessArgs(["--plan", "--", "--json"]);
	const payload = {
		ok: true,
		mode: parsed.planOnly ? "plan" : "run",
		steps: serializePlan(buildPlan()),
	};

	assert.equal(payload.ok, true);
	assert.equal(payload.mode, "plan");
	assert.equal(parsed.json, true);
	assert.equal(payload.steps.at(-1).id, "publish-dry-run");
	assert.equal(payload.steps.at(-2).id, "reference-driver");
	assert.equal(payload.steps.at(-3).id, "audience-boundary");
});
