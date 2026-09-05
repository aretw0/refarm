import assert from "node:assert/strict";
import test from "node:test";

globalThis.__REFARM_TRUSTED_PUBLISHING_PLAN_TEST__ = true;
const { trustedPublishingPlanFromArgs } = await import("./trusted-publishing-plan-cli.mjs");

test("trusted publishing CLI emits a machine-readable, token-free plan", () => {
	const { options, plan } = trustedPublishingPlanFromArgs(["--selection", "evidence-contracts-ready", "--json"]);
	assert.equal(plan.ok, true);
	assert.equal(options.json, true);
	assert.equal(plan.selectionId, "evidence-contracts-ready");
	assert.equal(plan.packages.length, 3);
	assert.equal("NPM_TOKEN" in plan, false);
});
