import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	GENERATED_AT,
	SCHEMA,
	runSovereignCitizenReference,
} from "./sovereign-citizen-reference.mjs";

describe("sovereign citizen reference", () => {
	it("proves issue -> verify -> present -> wallet with Heartwood signatures", async () => {
		const result = await runSovereignCitizenReference();

		assert.equal(result.schema, SCHEMA);
		assert.equal(result.generatedAt, GENERATED_AT);
		assert.equal(result.packages.identity, "@refarm.dev/identity-heartwood");
		assert.equal(result.packages.credentials, "@refarm.dev/credentials-contract-v1");
		assert.equal(result.packages.storageContract, "@refarm.dev/storage-contract-v1");
		assert.equal(result.packages.storage, "@refarm.dev/storage-memory");
		assert.equal(result.evidence.signatureAlgorithm, "ed25519-heartwood-v1");
		assert.equal(result.checks.credentialSignatureValid, true);
		assert.deepEqual(result.checks.credentialFailures, []);
		assert.deepEqual(result.checks.credentialPolicyChecks.signature, { ok: true });
		assert.deepEqual(result.checks.credentialPolicyChecks.issuerTrusted, { ok: true });
		assert.deepEqual(result.checks.credentialPolicyChecks.withinValidity, { ok: true });
		assert.deepEqual(result.checks.credentialPolicyChecks.claimsSatisfied, { ok: true });
		assert.deepEqual(result.checks.credentialPolicyChecks.notRevoked, { ok: true });
		assert.equal(result.checks.tamperedCredentialRejected, true);
		assert.equal(result.checks.revocationApplied, true);
		assert.equal(result.checks.revokedCredentialRejected, true);
		assert.equal(result.checks.revokedCredentialCheck.ok, false);
		assert.equal(result.checks.revokedCredentialCheck.code, "credential_revoked");
		assert.equal(result.checks.presentationSignatureValid, true);
		assert.deepEqual(result.checks.presentationFailures, []);
		assert.deepEqual(result.checks.presentationPolicyChecks.signature, { ok: true });
		assert.deepEqual(result.checks.presentationPolicyChecks.holderBound, { ok: true });
		assert.equal(result.checks.presentationHolderVerified, true);
		assert.equal(result.checks.walletStoredCredential, true);
		assert.equal(result.checks.walletListCount, 1);
		assert.equal(result.checks.walletRoundTripPreserved, true);
	});

	it("keeps the report sanitized and deterministic", async () => {
		const first = await runSovereignCitizenReference();
		const second = await runSovereignCitizenReference();

		assert.deepEqual(first, second);
		assert.match(first.evidence.credentialTemplateDigest, /^[a-f0-9]{64}$/);
		assert.match(first.evidence.presentationTemplateDigest, /^[a-f0-9]{64}$/);
		assert.equal(first.evidence.signatures, "redacted");
		assert.equal(first.evidence.identityIds, "redacted");

		const serialized = JSON.stringify(first);
		assert.doesNotMatch(serialized, /did:refarm:heartwood/);
		assert.doesNotMatch(serialized, /secret/i);
		assert.doesNotMatch(serialized, /identity-[0-9]/);
		assert.match(first.boundaries.join("\n"), /synthetic holder/);
		assert.match(first.boundaries.join("\n"), /does not claim legal/);
	});
});
