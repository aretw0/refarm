import assert from "node:assert/strict";
import test from "node:test";

import { buildRequirementsSupplyComposition } from "./requirements-supply-composition.mjs";

/** A machine under no pressure — what this composition's own logic is being judged against. */
const CLEAR_PRESSURE = {
	ok: true,
	decision: "continue",
	signals: [],
	nextCommands: [],
};

/** A machine under enough pressure that the node would rather serialize than fan out. */
const SAFE_MODE_PRESSURE = {
	ok: true,
	decision: "safe-mode",
	signals: [{ severity: "warning" }],
	nextCommands: [],
};

test("requirements supply composition proves cheap records plus enrichment preflight", async () => {
	const result = await buildRequirementsSupplyComposition({
		completedAt: "2026-06-30T00:00:00.000Z",
		// INJECTED, not measured. `decideGate` returns "serialize" whenever pressure is not
		// `continue`, so asserting "allow" against the real machine made this a test about the
		// runner's free memory. It went red on 2026-08-28 with 3GB of 31GB available and the gate
		// blamed an unrelated change in flight — a test that fails for a reason its subject does
		// not contain accuses whatever is nearest.
		pressure: CLEAR_PRESSURE,
	});

	// STILL BRANDED, and correctly: this is the CI script's OWN envelope, and `scripts/ci/` is not
	// a brand-free generic package — `release:brand:guard` polices packages/, not this. Only the
	// NESTED schemas below come from packages and were debranded. A blanket rename over this file
	// changed all three and this assertion caught it.
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
// THREE schemas in one payload and TWO different prefixes, which is the honest state and not a
	// typo: the envelope and the review report are this CI script's own (`scripts/ci/` is not a
	// brand-free package, so `refarm.*` is legitimate there), while the artifact manifest comes
	// from `packages/artifact-contract-v1`, which was debranded to `sovereign.*`.
	//
	// The trap underneath (ISS-112): `TASK_ARTIFACT_MANIFEST_SCHEMA` names two different values —
	// `sovereign.*` in the package and `refarm.*` on the CI surface. The duplicate LITERAL is gone
	// (2026-08-12): `local-first-platform-proof.mjs` imports the constant instead of copying its
	// value. The VALUE question is deliberately still open, because measuring found a second
	// producer: four checked-in expected fixtures and a declared proof target say vault-seed emits
	// `refarm.*`, and vault-seed is a separate repository reading this off disk.
	assert.equal(result.artifacts.manifest.schema, "sovereign.task-artifacts.v1");
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

test("it serializes rather than allowing when the machine is under pressure", async () => {
	// THE BRANCH THAT WAS ONLY EVER OBSERVED BY ACCIDENT — on a loaded machine, where it read as
	// a regression rather than as the rule working. Asserted here so it is a property, not a
	// symptom.
	const result = await buildRequirementsSupplyComposition({
		completedAt: "2026-06-30T00:00:00.000Z",
		pressure: SAFE_MODE_PRESSURE,
	});
	assert.equal(result.gateDecision, "serialize");
	assert.equal(result.pressure.decision, "safe-mode");
});
