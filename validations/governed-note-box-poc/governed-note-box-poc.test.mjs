import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
	buildConsumerEvidence,
	buildPilotScorecard,
	buildRiskAndStandardsMatrix,
	buildTaskArtefactManifest,
	runGovernedNoteBoxPoc,
} from "./governed-note-box-poc.mjs";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures", "expected");

function readFixture(fileName) {
	return JSON.parse(readFileSync(path.join(FIXTURES_DIR, fileName), "utf8"));
}

describe("governed note box poc", () => {
	it("preserves source metadata for every synthetic note", () => {
		const report = runGovernedNoteBoxPoc();

		assert.equal(report.intakeSnapshot.notes.length, 3);
		assert.equal(report.metadataIndex.notes.length, 3);
		assert.equal(report.checks.allNotesHaveMetadata, true);
		assert.ok(report.metadataIndex.notes.every((note) => note.bodyHash.length === 64));
	});

	it("keeps drafts out of the publication snapshot", () => {
		const report = runGovernedNoteBoxPoc();

		assert.deepEqual(
			report.publicationSnapshot.notes.map((note) => note.id),
			["note-001", "note-002"],
		);
		assert.equal(report.checks.draftsExcludedFromPublication, true);
		assert.equal(
			report.publicationSnapshot.notes.some((note) => note.id === "note-003"),
			false,
		);
	});

	it("creates lab metrics without requiring external services", () => {
		const report = runGovernedNoteBoxPoc();

		assert.equal(report.labSnapshot.metrics.notes, 3);
		assert.equal(report.labSnapshot.metrics.readyNotes, 2);
		assert.equal(report.labSnapshot.metrics.draftNotes, 1);
		assert.equal(report.labSnapshot.metrics.links, 4);
		assert.equal(report.checks.noExternalServices, true);
	});

	it("requires human review before publication", () => {
		const report = runGovernedNoteBoxPoc();

		assert.equal(report.publicationPreflight.checks.humanReviewRequired, true);
		assert.equal(report.publicationPreflight.blockers.length, 0);
		assert.deepEqual(report.publicationPreflight.warnings, [
			"Synthetic draft note withheld from publication snapshot.",
		]);
	});

	it("publishes a pilot scorecard with adoption thresholds", () => {
		const report = runGovernedNoteBoxPoc();
		const scorecard = buildPilotScorecard(report);

		assert.deepEqual(readFixture("scorecard.json"), scorecard);
		assert.equal(scorecard.scale, 5);
		assert.equal(scorecard.gate, "continue");
		assert.equal(scorecard.finalScore, 4.85);
		assert.equal(scorecard.scores.metadataPreservation, 5);
		assert.equal(scorecard.scores.humanReview, 4);
		assert.equal(scorecard.thresholds.continue, 4.5);
		assert.match(scorecard.limits[0], /Synthetic notes/);
	});

	it("publishes a risk and standards matrix without claiming conformance", () => {
		const report = runGovernedNoteBoxPoc();
		const matrix = buildRiskAndStandardsMatrix(report);

		assert.deepEqual(readFixture("risk-and-standards-matrix.json"), matrix);
		assert.equal(matrix.conformanceClaim, false);
		assert.equal(matrix.controls.length, 3);
		assert.ok(matrix.controls.every((control) => control.status === "demonstrated"));
		assert.deepEqual(
			matrix.gaps.map((gap) => gap.neededForClaim),
			["real vault integration", "complete publication workflow", "editorial policy completeness"],
		);
	});

	it("publishes consumer evidence without claiming real vault integration", () => {
		const report = runGovernedNoteBoxPoc();
		const consumerEvidence = buildConsumerEvidence(report);

		assert.deepEqual(readFixture("consumer-evidence.json"), consumerEvidence);
		assert.equal(consumerEvidence.claimStatus, "manifest-consumer-ready");
		assert.equal(consumerEvidence.scope.realVaultIntegration, false);
		assert.equal(consumerEvidence.consumerSelectors.length, 4);
		assert.deepEqual(
			consumerEvidence.consumerSelectors.map((selector) => selector.id),
			[
				"lab-datasets",
				"publication-datasets",
				"publication-preflight",
				"consumer-readiness-report",
			],
		);
		assert.ok(
			consumerEvidence.evidenceCommands.includes("pnpm run validation-pocs:consumer:test"),
		);
		assert.ok(
			consumerEvidence.cannotSay.some((claim) => claim.includes("real vault integration")),
		);
	});

	it("keeps generated fixtures small, synthetic, and deterministic", () => {
		const report = runGovernedNoteBoxPoc();

		assert.deepEqual(readFixture("intake-snapshot.json"), report.intakeSnapshot);
		assert.deepEqual(readFixture("metadata-index.json"), report.metadataIndex);
		assert.deepEqual(readFixture("lab-snapshot.json"), report.labSnapshot);
		assert.deepEqual(readFixture("publication-snapshot.json"), report.publicationSnapshot);
		assert.deepEqual(readFixture("publication-preflight.json"), report.publicationPreflight);
		const scenario = readFileSync(path.join(FIXTURES_DIR, "scenario.md"), "utf8");
		assert.match(scenario, /Governed Note Box PoC Scenario/);
		assert.match(scenario, /Decision Points/);
		const annex = readFileSync(path.join(FIXTURES_DIR, "annex.md"), "utf8");
		assert.match(annex, /Flow Table/);
		assert.match(annex, /Notes ingested/);
		assert.match(annex, /Evidence Map/);
		assert.match(annex, /scorecard\.json/);

		const review = readFileSync(path.join(FIXTURES_DIR, "human-review.md"), "utf8");
		assert.match(review, /No real vault, work draft, personal data, institutional data, or secrets/);
		assert.match(review, /Drafts excluded from publication \| true/);
	});

	it("publishes a task artefact manifest for downstream labs", () => {
		const manifest = readFixture("task-artefacts.json");

		assert.equal(manifest.schema, "refarm.task-artefacts.v1");
		assert.equal(manifest.taskId, "task-governed-note-box-poc");
		assert.equal(manifest.effortId, "effort-governed-note-box-poc-001");
		assert.deepEqual(
			manifest.artefacts.map((artefact) => artefact.uri),
			[
				"intake-snapshot.json",
				"metadata-index.json",
				"lab-snapshot.json",
				"publication-snapshot.json",
				"publication-preflight.json",
				"scorecard.json",
				"risk-and-standards-matrix.json",
				"consumer-evidence.json",
				"scenario.md",
				"annex.md",
				"human-review.md",
			],
		);
		assert.equal(
			manifest.artefacts.find((artefact) => artefact.id === "publication-snapshot")?.reviewState,
			"unreviewed",
		);
		assert.ok(
			manifest.artefacts.every(
				(artefact) =>
					artefact.hash.algorithm === "sha256" &&
					/^[a-f0-9]{64}$/.test(artefact.hash.value) &&
					artefact.provenance.runId === "governed-note-box-poc-001",
			),
		);
	});

	it("builds the task artefact manifest deterministically", () => {
		const expected = readFixture("task-artefacts.json");
		const actual = buildTaskArtefactManifest(
			Object.fromEntries(
				expected.artefacts.map((artefact) => [
					artefact.uri,
					readFileSync(path.join(FIXTURES_DIR, artefact.uri), "utf8"),
				]),
			),
		);

		assert.deepEqual(actual, expected);
	});
});
