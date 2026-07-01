import assert from "node:assert/strict";
import test from "node:test";

import { buildRequirementsSupplyComposition } from "./requirements-supply-composition.mjs";

test("requirements supply composition proves cheap records plus enrichment preflight", async () => {
	const result = await buildRequirementsSupplyComposition({
		completedAt: "2026-06-30T00:00:00.000Z",
	});

	assert.equal(result.schema, "refarm.requirements-supply-composition.v1");
	assert.equal(result.ok, true);
	assert.equal(result.mode, "synthetic-sanitized-composition");
	assert.equal(result.gateDecision, "allow");
	assert.equal(result.pressure.ok, true);
	assert.equal(result.source.capability, "source:v1");
	assert.deepEqual(result.source.kinds, ["local"]);
	assert.equal(result.source.location.kind, "local");
	assert.equal(result.source.status.materialized, true);
	assert.equal(result.source.status.clean, true);
	assert.equal(result.source.status.dirty, false);
	assert.equal(result.source.provenance.session.kind, "fixture");
	assert.equal(result.source.provenance.session.authenticated, true);
	assert.equal(result.source.provenance.cache.offlineReplay, true);
	assert.match(result.source.provenance.cache.hash, /^sha256:/);
	assert.deepEqual(result.source.provenance.redaction.fields, [
		"cookie",
		"authorization",
		"set-cookie",
	]);
	assert.equal(result.records.capability, "records:v1");
	assert.equal(result.records.total, 2);
	assert.equal(result.records.initialValidation.ok, true);
	assert.equal(result.records.finalValidation.ok, true);
	assert.equal(result.records.sourceCoverage.complete, true);
	assert.deepEqual(result.records.reviewStates, {
		draft: 1,
		reviewed: 1,
	});
	assert.equal(result.enrichment.capability, "enrichment:v1");
	assert.equal(result.enrichment.mode, "dry-run");
	assert.equal(result.enrichment.diagnostics.total, 2);
	assert.equal(result.enrichment.diagnostics.enriched, 2);
	assert.equal(result.enrichment.diagnostics.skipped, 0);
	assert.deepEqual(result.enrichment.changedRecordIds, [
		"record:requirements-root",
		"record:requirements-child",
	]);
	assert.equal(result.artifacts.capability, "artifact:v1");
	assert.equal(result.artifacts.validation.ok, true);
	assert.equal(result.artifacts.validation.issueCount, 0);
	assert.equal(result.artifacts.manifest.schema, "refarm.task-artifacts.v1");
	assert.equal(result.artifacts.manifest.artifacts.length, 4);
	assert.deepEqual(
		result.artifacts.manifest.artifacts.map((artifact) => artifact.id),
		[
			"source-web-snapshot",
			"records-manifest",
			"enrichment-report",
			"review-report",
		],
	);
	assert.equal(result.artifacts.reviewReport.schema, "refarm.requirements-supply-review.v1");
	assert.equal(result.artifacts.reviewReport.source.offlineReplay, true);
	assert.equal(result.artifacts.reviewReport.source.redacted, true);
	assert.equal(result.artifacts.reviewReport.records.validation.ok, true);
	assert.match(result.boundaries.join("\n"), /does not run browser automation/);
	assert.match(result.boundaries.join("\n"), /official publication handoff remains release:vault-seed:handoff/);
	assert.match(result.nextActions.join("\n"), /downstream reference-vault proof/);
	assert.deepEqual(result.issues, []);
});
