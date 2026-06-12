import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
	authorizationPayload,
	buildPilotScorecard,
	buildRiskAndStandardsMatrix,
	buildTaskArtefactManifest,
	createAuthorizationReceipt,
	createAuthorityAttributes,
	createConsentDecision,
	createRevocationEvent,
	createSelectivePresentation,
	createServiceRequest,
	runWalletPoc,
	verifyPayloadSignature,
} from "./wallet-poc.mjs";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures", "expected");

function readFixture(fileName) {
	return JSON.parse(readFileSync(path.join(FIXTURES_DIR, fileName), "utf8"));
}

describe("citizen data wallet poc", () => {
	it("creates an authorization with purpose, expiration, and explicit scope", () => {
		const request = createServiceRequest();
		const receipt = createAuthorizationReceipt(request);

		assert.equal(receipt.purpose, request.purpose);
		assert.equal(receipt.expiresAt, request.expiresAt);
		assert.deepEqual(receipt.scope, ["faixa_etaria", "vinculo"]);
		assert.equal(receipt.status, "active");
	});

	it("creates a selective presentation without leaking unrequested attributes", () => {
		const attributes = createAuthorityAttributes();
		const receipt = createAuthorizationReceipt();
		const presentation = createSelectivePresentation(attributes, receipt);

		assert.deepEqual(Object.keys(presentation.attributes).sort(), [
			"faixa_etaria",
			"vinculo",
		]);
		assert.equal(presentation.attributes.municipio, undefined);
		assert.equal(presentation.attributes.nome_social, undefined);
	});

	it("verifies the authorization signature", () => {
		const receipt = createAuthorizationReceipt();

		assert.equal(
			verifyPayloadSignature(authorizationPayload(receipt), receipt.proof.signature),
			true,
		);
	});

	it("rejects a tampered authorization payload", () => {
		const receipt = createAuthorizationReceipt();
		const tamperedPayload = {
			...authorizationPayload(receipt),
			scope: [...receipt.scope, "municipio"],
		};

		assert.equal(verifyPayloadSignature(tamperedPayload, receipt.proof.signature), false);
	});

	it("marks a revoked authorization as unusable", () => {
		const receipt = createAuthorizationReceipt();
		const revocation = createRevocationEvent(receipt);

		assert.equal(revocation.statusBefore, "active");
		assert.equal(revocation.statusAfter, "revoked");
		assert.equal(runWalletPoc().checks.revokedUsable, false);
	});

	it("publishes a human-reviewable consent decision", () => {
		const result = runWalletPoc();
		const decision = createConsentDecision({
			request: result.request,
			authorization: result.authorization,
			presentation: result.presentation,
			revocation: result.revocation,
		});

		assert.deepEqual(result.consentDecision, decision);
		assert.equal(decision.operatorReview.required, true);
		assert.equal(decision.presentation.attributesRequested, 2);
		assert.equal(decision.presentation.attributesPresented, 2);
		assert.deepEqual(decision.presentation.unrequestedDisclosures, []);
		assert.equal(decision.revocation.usableAfterRevocation, false);
	});

	it("publishes a pilot scorecard with adoption thresholds", () => {
		const result = runWalletPoc();
		const scorecard = buildPilotScorecard(result);

		assert.deepEqual(readFixture("scorecard.json"), scorecard);
		assert.equal(scorecard.scale, 5);
		assert.equal(scorecard.gate, "continue");
		assert.equal(scorecard.finalScore, 4.9);
		assert.equal(scorecard.scores.selectiveDisclosure, 5);
		assert.equal(scorecard.scores.humanReview, 4);
		assert.equal(scorecard.thresholds.continue, 4.5);
		assert.match(scorecard.limits[0], /Synthetic signature/);
	});

	it("publishes a risk and standards matrix without claiming conformance", () => {
		const result = runWalletPoc();
		const matrix = buildRiskAndStandardsMatrix(result);

		assert.deepEqual(readFixture("risk-and-standards-matrix.json"), matrix);
		assert.equal(matrix.conformanceClaim, false);
		assert.equal(matrix.controls.length, 3);
		assert.ok(matrix.controls.every((control) => control.status === "demonstrated"));
		assert.deepEqual(
			matrix.gaps.map((gap) => gap.neededForClaim),
			[
				"VC or OpenID conformance",
				"production service readiness",
				"legal or institutional compliance",
			],
		);
	});

	it("keeps generated fixtures small, synthetic, and deterministic", () => {
		const result = runWalletPoc();

		assert.deepEqual(readFixture("identity.json"), result.identity);
		assert.deepEqual(readFixture("authority-attributes.json"), result.attributes);
		assert.deepEqual(readFixture("service-request.json"), result.request);
		assert.deepEqual(readFixture("authorization-receipt.json"), result.authorization);
		assert.deepEqual(readFixture("selective-presentation.json"), result.presentation);
		assert.deepEqual(readFixture("revocation-event.json"), result.revocation);
		assert.deepEqual(readFixture("consent-decision.json"), result.consentDecision);
		const scenario = readFileSync(path.join(FIXTURES_DIR, "scenario.md"), "utf8");
		assert.match(scenario, /Citizen Data Wallet PoC Scenario/);
		assert.match(scenario, /Decision Points/);
		const annex = readFileSync(path.join(FIXTURES_DIR, "annex.md"), "utf8");
		assert.match(annex, /Flow Table/);
		assert.match(annex, /Service requests proof/);
		assert.match(annex, /Evidence Map/);
		assert.match(annex, /scorecard\.json/);

		const auditTrail = readFileSync(path.join(FIXTURES_DIR, "audit-trail.md"), "utf8");
		assert.match(auditTrail, /No real personal, institutional, or secret data is used/);
		assert.match(auditTrail, /Attributes available: 4/);
		assert.match(auditTrail, /Tamper verification result: false/);
	});

	it("publishes a task artefact manifest for downstream labs", () => {
		const manifest = readFixture("task-artefacts.json");

		assert.equal(manifest.schema, "refarm.task-artefacts.v1");
		assert.equal(manifest.taskId, "task-citizen-data-wallet-poc");
		assert.equal(manifest.effortId, "effort-citizen-data-wallet-poc-001");
		assert.equal(manifest.artefacts.length, 12);
		assert.deepEqual(
			manifest.artefacts.map((artefact) => artefact.uri),
			[
				"identity.json",
				"authority-attributes.json",
				"service-request.json",
				"authorization-receipt.json",
				"selective-presentation.json",
				"revocation-event.json",
				"consent-decision.json",
				"scorecard.json",
				"risk-and-standards-matrix.json",
				"scenario.md",
				"annex.md",
				"audit-trail.md",
			],
		);
		assert.ok(
			manifest.artefacts.every(
				(artefact) =>
					artefact.hash.algorithm === "sha256" &&
					/^[a-f0-9]{64}$/.test(artefact.hash.value) &&
					artefact.reviewState === "accepted" &&
					artefact.provenance.runId === "citizen-data-wallet-poc-001",
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
