import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const SCRIPT = "scripts/ci/release-readiness.mjs";

test("prints an ordered release readiness plan", () => {
	const output = execFileSync(process.execPath, [SCRIPT, "--plan"], {
		encoding: "utf8",
	});

	assert.match(output, /operator-readiness: .*refarm:check:gate/);
	assert.match(output, /release-policy: .*release:policy:check/);
	assert.match(output, /node-substrate: .*node-substrate:check/);
	assert.match(output, /rust-substrate: .*rust-substrate:check/);
	assert.match(output, /environment-substrate: .*environment-substrate:check/);
	assert.match(output, /derived-artifacts: .*workspace:artifacts:ownership/);
	assert.match(output, /github-actions-pins: .*actions:pins/);
	assert.match(output, /github-actions-contracts: .*actions:contracts/);
	assert.match(output, /publish-dry-run: .*release:check/);
});

test("prints structured release readiness metadata", () => {
	const output = execFileSync(process.execPath, [SCRIPT, "--plan", "--json"], {
		encoding: "utf8",
	});
	const payload = JSON.parse(output);

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
			"derived-artifacts",
			"github-actions-pins",
			"github-actions-contracts",
			"publish-dry-run",
		],
	);
});
