import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
	authorizationPayload,
	createAuthorizationReceipt,
	createAuthorityAttributes,
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

	it("keeps generated fixtures small, synthetic, and deterministic", () => {
		const result = runWalletPoc();

		assert.deepEqual(readFixture("identity.json"), result.identity);
		assert.deepEqual(readFixture("authority-attributes.json"), result.attributes);
		assert.deepEqual(readFixture("service-request.json"), result.request);
		assert.deepEqual(readFixture("authorization-receipt.json"), result.authorization);
		assert.deepEqual(readFixture("selective-presentation.json"), result.presentation);
		assert.deepEqual(readFixture("revocation-event.json"), result.revocation);

		const auditTrail = readFileSync(path.join(FIXTURES_DIR, "audit-trail.md"), "utf8");
		assert.match(auditTrail, /No real personal, institutional, or secret data is used/);
		assert.match(auditTrail, /Attributes available: 4/);
		assert.match(auditTrail, /Tamper verification result: false/);
	});
});
