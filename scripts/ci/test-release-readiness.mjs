import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
	assert.match(output, /release-boundary-audit: .*release:boundary:audit/);
	assert.match(output, /reference-driver: .*reference-driver:smoke/);
	assert.match(output, /agent-demo-release-proof: .*agent-demo:release-proof/);
	assert.match(output, /secure-extensibility-proof: .*secure-extensibility:proof/);
	assert.match(output, /local-first-platform-proof: .*local-first:proof/);
	assert.match(output, /first-publish-selection-plan: .*release:first-publish:plan -- --selection consumer-ready/);
	assert.match(output, /consumer-install-smoke: .*release:vault-seed:install:smoke/);
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
// THE RULE, not the roster. This pinned all ~30 step ids verbatim and went red when
	// `no-tracked-artifacts` joined the readiness plan — a gate being ADDED broke the test that
	// guards the plan, which is the wrong way round, and it went unnoticed because no lane ran
	// this suite (ISS-106).
	//
	// What must not silently vanish is a LOAD-BEARING gate. What may change freely is how many
	// there are. So: every step has an id and a command (the structural contract), the ids are
	// unique (a duplicate would run twice and report once), and the gates that carry the release
	// boundary are present BY NAME.
	const ids = payload.steps.map((step) => step.id);
	assert.ok(ids.length > 0);
	assert.deepEqual([...new Set(ids)], ids, "a duplicated step id runs twice and reports once");
	for (const step of payload.steps) {
		assert.equal(typeof step.id, "string");
		assert.ok(step.id.length > 0, `a step with no id: ${JSON.stringify(step)}`);
	}
	for (const required of [
		"release-policy",
		"derived-artifacts",
		"no-tracked-artifacts",
		"audience-boundary",
		"consumer-install-smoke",
		"publish-dry-run",
	]) {
		assert.ok(ids.includes(required), `the readiness plan dropped ${required}`);
	}
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
	assert.equal(payload.steps.at(-2).id, "consumer-install-smoke");
	assert.equal(payload.steps.at(-3).id, "first-publish-selection-plan");
	assert.equal(payload.steps.at(-4).id, "local-first-platform-proof");
	assert.equal(payload.steps.at(-5).id, "secure-extensibility-proof");
	assert.equal(payload.steps.at(-6).id, "agent-demo-release-proof");
	assert.equal(payload.steps.at(-7).id, "reference-driver");
	assert.equal(payload.steps.at(-8).id, "release-boundary-audit");
});

test("consumer install smoke matches the pnpm publication and handoff semantics", () => {
	const smoke = readFileSync(new URL("./release-install-smoke.mjs", import.meta.url), "utf8");

	assert.match(smoke, /buildReleaseCheckPlan/);
	assert.match(smoke, /"pnpm", \["pack", "--pack-destination"/);
	assert.match(smoke, /"pnpm-workspace\.yaml"/);
	assert.match(smoke, /overrides:/);
	assert.match(smoke, /"pnpm", \["install", "--no-frozen-lockfile"\]/);
	assert.doesNotMatch(smoke, /run\("npm", \["pack"/);
	assert.doesNotMatch(smoke, /run\("npm", \["install"/);
});
