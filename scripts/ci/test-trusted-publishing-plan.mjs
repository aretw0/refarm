import assert from "node:assert/strict";
import test from "node:test";
import {
	TRUSTED_PUBLISHING_NPM_VERSION,
	TRUSTED_PUBLISHING_REPOSITORY,
	TRUSTED_PUBLISHING_WORKFLOW,
	buildTrustedPublishingPlan,
	parseTrustedPublishingPlanArgs,
} from "./trusted-publishing-plan.mjs";

test("trusted publishing plan names the stage-only migration and exact GitHub claim", () => {
	const plan = buildTrustedPublishingPlan();
	assert.equal(plan.ok, true);
	assert.equal(plan.selectionId, "consumer-ready");
	assert.equal(plan.strategy, "bootstrap-token-then-stage-only-oidc");
	assert.equal(plan.trustedPublisher.repository, TRUSTED_PUBLISHING_REPOSITORY);
	assert.equal(plan.trustedPublisher.workflow, TRUSTED_PUBLISHING_WORKFLOW);
	assert.equal(plan.trustedPublisher.allowedAction, "npm stage publish");
	assert.equal(plan.trustedPublisher.npmVersion, `>=${TRUSTED_PUBLISHING_NPM_VERSION}`);
	assert.equal(plan.packages.length, 27);
	assert.deepEqual(plan.repositoryMismatches, []);
	for (const pkg of plan.packages) {
		assert.equal(pkg.repositoryMatches, true, pkg.name);
		assert.match(pkg.npmUrl, /^https:\/\/www\.npmjs\.com\/package\/%40refarm\.dev%2F/);
		assert.match(pkg.trustCommand, /--file release-changesets\.yml --repo aretw0\/refarm --allow-stage-publish --yes$/);
	}
});

test("parser accepts selection and JSON output only", () => {
	assert.deepEqual(parseTrustedPublishingPlanArgs(["--selection", "evidence-contracts-ready", "--json"]), {
		selectionId: "evidence-contracts-ready",
		json: true,
	});
	assert.throws(() => parseTrustedPublishingPlanArgs(["--publish"]), /Unknown trusted-publishing option/);
});
