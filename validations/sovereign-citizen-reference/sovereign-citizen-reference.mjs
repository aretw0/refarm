import { createHash } from "node:crypto";

import { createReferenceCredentialsProvider } from "../../packages/credentials-contract-v1/dist/index.js";
import {
	HEARTWOOD_IDENTITY_ALGORITHM,
	createHeartwoodIdentityProvider,
} from "../../packages/identity-heartwood/dist/index.js";
import { createInMemoryStorageProvider } from "../../packages/storage-contract-v1/dist/index.js";

export const SCHEMA = "refarm.sovereign-citizen-reference.v1";
export const GENERATED_AT = "2026-07-01T00:00:00.000Z";

const VC_TYPE = "SovereignCitizenReferenceCredential";
const SYNTHETIC_SUBJECT = {
	ageOver18: true,
	residency: "synthetic-municipality",
	entitlementClass: "synthetic-benefit",
};

function canonicalJson(value) {
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

function withoutProof(value) {
	const { proof: _proof, ...rest } = value;
	return rest;
}

function sanitizedCredentialTemplate() {
	return {
		"@context": [
			"https://www.w3.org/2018/credentials/v1",
			"https://refarm.dev/contexts/credentials/v1",
		],
		type: ["VerifiableCredential", VC_TYPE],
		id: "urn:refarm:credential:sovereign-citizen-reference",
		issuer: "<heartwood-issuer>",
		issuanceDate: GENERATED_AT,
		expirationDate: "2027-01-01T00:00:00.000Z",
		credentialSubject: {
			id: "<heartwood-holder>",
			...SYNTHETIC_SUBJECT,
		},
	};
}

function credentialForIssue(holderId) {
	const template = sanitizedCredentialTemplate();
	return {
		...template,
		issuer: "pending",
		credentialSubject: {
			...template.credentialSubject,
			id: holderId,
		},
	};
}

export async function runSovereignCitizenReference() {
	const identity = createHeartwoodIdentityProvider();
	const storage = createInMemoryStorageProvider();
	const credentials = createReferenceCredentialsProvider({
		identity,
		storage,
		pluginId: "@refarm.dev/credentials-sovereign-citizen-reference",
	});
	const issuer = await identity.create("Synthetic civic issuer");
	const holder = await identity.create("Synthetic holder");

	const credential = await credentials.issue(credentialForIssue(holder.id), issuer.id);
	const credentialVerification = await credentials.verify(credential);
	const tamperedCredential = {
		...credential,
		credentialSubject: {
			...credential.credentialSubject,
			entitlementClass: "tampered-benefit",
		},
	};
	const tamperedVerification = await credentials.verify(tamperedCredential);
	const presentation = await credentials.present([credential], holder.id);
	const presentationVerification = await credentials.verify(presentation);
	const stored = await credentials.store(credential);
	const listed = await credentials.list({ issuer: credential.issuer });
	const listedCredential = listed[0] ?? null;

	const unsignedCredentialDigest = sha256(canonicalJson(sanitizedCredentialTemplate()));
	const redactedPresentationDigest = sha256(canonicalJson({
		"@context": presentation["@context"],
		type: presentation.type,
		holder: "<heartwood-holder>",
		verifiableCredential: ["<redacted-verifiable-credential>"],
	}));

	return {
		schema: SCHEMA,
		generatedAt: GENERATED_AT,
		packages: {
			identity: "@refarm.dev/identity-heartwood",
			credentials: "@refarm.dev/credentials-contract-v1",
			storage: "@refarm.dev/storage-contract-v1",
		},
		flow: [
			"create heartwood issuer and holder identities",
			"issue credentials:v1 credential with heartwood issuer signature",
			"verify issued credential",
			"reject tampered credential",
			"present credential with heartwood holder signature",
			"verify presentation",
			"store and list credential through holder wallet storage",
		],
		evidence: {
			credentialTemplateDigest: unsignedCredentialDigest,
			presentationTemplateDigest: redactedPresentationDigest,
			signatureAlgorithm: HEARTWOOD_IDENTITY_ALGORITHM,
			signatures: "redacted",
			identityIds: "redacted",
			walletRecordId: stored.id,
		},
		checks: {
			credentialSignatureValid: credentialVerification.valid,
			credentialFailures: credentialVerification.failures,
			tamperedCredentialRejected: !tamperedVerification.valid,
			presentationSignatureValid: presentationVerification.valid,
			presentationFailures: presentationVerification.failures,
			presentationHolderVerified: presentationVerification.holder === holder.id,
			walletStoredCredential: Boolean(stored.id),
			walletListCount: listed.length,
			walletRoundTripPreserved: listedCredential
				? canonicalJson(withoutProof(listedCredential)) === canonicalJson(withoutProof(credential))
				: false,
		},
		boundaries: [
			"uses synthetic holder, issuer, verifier, and attributes only",
			"does not publish private keys, signatures, public keys, or DID values in the report",
			"does not claim legal, institutional, W3C VC, OpenID4VP, or production wallet UX readiness",
			"issuer trust registries, credential schemas, revocation policy, and wallet UX remain host-owned",
		],
		nextActions: [
			"wire issuer trust policy as a consumer-owned package or fixture before release promotion",
			"add downstream wallet UX proof before selecting credentials packages for vault-seed-ready",
			"keep heartwood identity as a provider package rather than replacing identity:v1",
		],
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const result = await runSovereignCitizenReference();
	console.log(JSON.stringify(result, null, 2));
}
