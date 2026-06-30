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
	assert.match(result.boundaries.join("\n"), /does not run browser automation/);
	assert.match(result.boundaries.join("\n"), /does not add release-policy/);
	assert.match(result.nextActions.join("\n"), /downstream local handoff evidence/);
	assert.deepEqual(result.issues, []);
});
