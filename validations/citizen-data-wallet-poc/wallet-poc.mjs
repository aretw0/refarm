import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Synthetic deterministic test key. It is committed so fixtures stay reproducible.
const FIXED_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIJXni5KOlcCL7b4L4SXE+RyUDTbo2YEu3wBI4wW3hF/O
-----END PRIVATE KEY-----`;

export const HOLDER_ID = "cidadao-exemplo-001";
export const ISSUER_ID = "emissor-publico-sintetico";
export const VERIFIER_ID = "servico-sintetico-beneficio";
export const AUTHORIZATION_ID = "authz-sintetica-001";
export const ISSUED_AT = "2026-01-01T00:00:00.000Z";
export const EXPIRES_AT = "2026-02-01T00:00:00.000Z";
export const REVOKED_AT = "2026-01-15T12:00:00.000Z";
export const TASK_ARTEFACTS_SCHEMA = "refarm.task-artefacts.v1";
export const TASK_ID = "task-citizen-data-wallet-poc";
export const EFFORT_ID = "effort-citizen-data-wallet-poc-001";
export const RUN_ID = "citizen-data-wallet-poc-001";

const SYNTHETIC_ATTRIBUTES = {
	nome_social: "Pessoa Exemplo",
	faixa_etaria: "maior_de_18",
	municipio: "Municipio Exemplo",
	vinculo: "beneficiario_sintetico",
};

const REQUESTED_ATTRIBUTES = ["faixa_etaria", "vinculo"];

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

function publicKeyJwk() {
	return createPublicKey(FIXED_PRIVATE_KEY_PEM).export({ format: "jwk" });
}

function sha256Text(value) {
	return createHash("sha256").update(value).digest("hex");
}

function jsonText(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function signPayload(payload) {
	const privateKey = createPrivateKey(FIXED_PRIVATE_KEY_PEM);
	return sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64url");
}

export function verifyPayloadSignature(payload, signature) {
	return verify(
		null,
		Buffer.from(canonicalJson(payload)),
		createPublicKey(FIXED_PRIVATE_KEY_PEM),
		Buffer.from(signature, "base64url"),
	);
}

export function createIdentity() {
	return {
		id: HOLDER_ID,
		type: "synthetic-local-identity",
		displayName: "Pessoa Exemplo",
		publicKey: publicKeyJwk(),
		createdAt: ISSUED_AT,
	};
}

export function createAuthorityAttributes() {
	return {
		issuer: ISSUER_ID,
		subject: HOLDER_ID,
		issuedAt: ISSUED_AT,
		attributes: SYNTHETIC_ATTRIBUTES,
	};
}

export function createServiceRequest() {
	return {
		id: "request-beneficio-sintetico-001",
		requester: VERIFIER_ID,
		subject: HOLDER_ID,
		purpose: "verificar elegibilidade sintetica para atendimento demonstrativo",
		justification:
			"Somente faixa etaria e vinculo sintetico sao necessarios para esta simulacao.",
		requestedAttributes: REQUESTED_ATTRIBUTES,
		expiresAt: EXPIRES_AT,
	};
}

export function createAuthorizationReceipt(serviceRequest = createServiceRequest()) {
	const payload = {
		id: AUTHORIZATION_ID,
		holder: HOLDER_ID,
		requester: serviceRequest.requester,
		purpose: serviceRequest.purpose,
		scope: serviceRequest.requestedAttributes,
		issuedAt: ISSUED_AT,
		expiresAt: serviceRequest.expiresAt,
		status: "active",
	};

	return {
		...payload,
		proof: {
			type: "Ed25519Signature2020-inspired",
			algorithm: "Ed25519",
			signature: signPayload(payload),
		},
	};
}

export function createSelectivePresentation(
	attributes = createAuthorityAttributes(),
	authorization = createAuthorizationReceipt(),
) {
	const presentedAttributes = Object.fromEntries(
		authorization.scope.map((name) => [name, attributes.attributes[name]]),
	);

	return {
		id: "presentation-beneficio-sintetico-001",
		holder: HOLDER_ID,
		requester: authorization.requester,
		authorizationId: authorization.id,
		presentedAt: ISSUED_AT,
		attributes: presentedAttributes,
	};
}

export function createRevocationEvent(authorization = createAuthorizationReceipt()) {
	return {
		id: "revocation-authz-sintetica-001",
		authorizationId: authorization.id,
		holder: HOLDER_ID,
		revokedAt: REVOKED_AT,
		statusBefore: authorization.status,
		statusAfter: "revoked",
		reason: "revogacao sintetica solicitada pelo titular ficticio",
	};
}

export function authorizationPayload(receipt) {
	const { proof: _proof, ...payload } = receipt;
	return payload;
}

export function buildAuditTrail(artifacts) {
	return `# Citizen Data Wallet PoC Audit Trail

Scope: synthetic local validation only. No real personal, institutional, or secret data is used.

| Step | Input | Output | Verification |
| --- | --- | --- | --- |
| Identity | Synthetic holder id | identity.json | Local public key is present |
| Attributes | Synthetic issuer and four attributes | authority-attributes.json | Attributes are scoped to the fictitious holder |
| Request | Synthetic service need | service-request.json | Purpose, expiration, and requested attributes are explicit |
| Authorization | Request + holder key | authorization-receipt.json | Signature verifies against the canonical payload |
| Presentation | Authorization scope + attributes | selective-presentation.json | Only ${Object.keys(artifacts.presentation.attributes).length} of ${Object.keys(artifacts.attributes.attributes).length} attributes are disclosed |
| Tamper check | Modified authorization payload | no artifact | Signature verification fails |
| Revocation | Active authorization | revocation-event.json | Status changes from active to revoked |

## Metrics

- Attributes available: ${Object.keys(artifacts.attributes.attributes).length}
- Attributes requested: ${artifacts.request.requestedAttributes.length}
- Attributes presented: ${Object.keys(artifacts.presentation.attributes).length}
- Authorization status before revocation: ${artifacts.revocation.statusBefore}
- Authorization status after revocation: ${artifacts.revocation.statusAfter}
- Tamper verification result: false
`;
}

export function buildScenarioMarkdown(result) {
	return `# Citizen Data Wallet PoC Scenario

Scope: synthetic local validation only. No real personal, institutional, or secret data is used.

## Problem

A digital service needs proof of eligibility without repeatedly collecting unnecessary attributes. The scenario asks whether a local wallet flow can express purpose, scope, expiration, selective disclosure, revocation, and tamper detection as reviewable evidence.

## Actors

- Holder: synthetic citizen identity.
- Issuer: synthetic public attribute source.
- Verifier: synthetic service requesting limited attributes.
- Operator: reviews consent, revocation, and pilot readiness.

## Decision Points

1. The service request must state purpose, requested attributes, and expiration.
2. The authorization receipt must verify against its signed payload.
3. The presentation must disclose only requested attributes.
4. Revocation must make the authorization unusable.

## Outcome

The synthetic wallet had ${Object.keys(result.attributes.attributes).length} available attributes, requested ${result.request.requestedAttributes.length}, and presented ${Object.keys(result.presentation.attributes).length}. Tamper verification failed as expected, and the consent decision still requires human review.
`;
}

export function buildAnnexMarkdown(result, scorecard) {
	const scoreRows = Object.entries(scorecard.scores)
		.map(([criterion, score]) => {
			const weight = scorecard.weights[criterion];
			return `| ${criterion} | ${score} | ${weight} | ${evidenceForWalletCriterion(criterion)} |`;
		})
		.join("\n");
	const flowRows = [
		["1", "Service requests proof", "Require purpose, scope, and expiration", "service-request.json"],
		["2", "Holder authorizes", "Sign canonical authorization payload", "authorization-receipt.json"],
		["3", "Wallet presents attributes", "Disclose only authorized fields", "selective-presentation.json"],
		["4", "Authorization is challenged", "Reject tampered payload", "audit-trail.md"],
		["5", "Holder revokes", "Record status transition", "revocation-event.json"],
		["6", "Pilot reviewed", "Read consent decision and scorecard", "continue or needs-human-review gate"],
	]
		.map((row) => `| ${row.join(" | ")} |`)
		.join("\n");

	return `# Citizen Data Wallet PoC Annex

## Flow Table

| Step | Event | Control | Output |
| ---: | --- | --- | --- |
${flowRows}

## Evidence Map

| Claim | Generated evidence |
| --- | --- |
| Purpose and scope are explicit | \`service-request.json\`, \`authorization-receipt.json\` |
| Disclosure is minimized | \`selective-presentation.json\` |
| Integrity is testable | \`authorization-receipt.json\`, audit trail tamper check |
| Revocation is reviewable | \`revocation-event.json\`, \`consent-decision.json\` |
| Pilot decision is measurable | \`scorecard.json\` |

## Scorecard Criteria

| Criterion | Score | Weight | Evidence |
| --- | ---: | ---: | --- |
${scoreRows}

## Reader Path

1. Read \`scenario.md\` for the service journey.
2. Inspect \`consent-decision.json\` for the review point.
3. Inspect \`scorecard.json\` for thresholds and limits.
4. Use \`task-artefacts.json\` to verify hashes and provenance.
`;
}

export function createConsentDecision({
	request = createServiceRequest(),
	authorization = createAuthorizationReceipt(request),
	presentation = createSelectivePresentation(createAuthorityAttributes(), authorization),
	revocation = createRevocationEvent(authorization),
} = {}) {
	const requested = new Set(request.requestedAttributes);
	const presented = Object.keys(presentation.attributes);
	const unrequestedDisclosures = presented.filter((attribute) => !requested.has(attribute));

	return {
		id: "consent-decision-authz-sintetica-001",
		authorizationId: authorization.id,
		decidedAt: ISSUED_AT,
		holder: authorization.holder,
		requester: authorization.requester,
		purpose: authorization.purpose,
		scope: authorization.scope,
		expiresAt: authorization.expiresAt,
		presentation: {
			attributesRequested: request.requestedAttributes.length,
			attributesPresented: presented.length,
			unrequestedDisclosures,
		},
		revocation: {
			revokedAt: revocation.revokedAt,
			statusAfter: revocation.statusAfter,
			usableAfterRevocation: revocation.statusAfter !== "revoked",
		},
		operatorReview: {
			required: true,
			reason:
				"Synthetic consent decision includes purpose, scope, expiration, selective disclosure, and revocation evidence for human review.",
		},
	};
}

export function buildPilotScorecard(result) {
	const scores = {
		purposeAndScope: result.request.purpose && result.request.requestedAttributes.length > 0 ? 5 : 0,
		selectiveDisclosure:
			Object.keys(result.presentation.attributes).length === result.request.requestedAttributes.length
				? 5
				: 2,
		signatureIntegrity: result.checks.signatureValid && !result.checks.tamperedSignatureValid ? 5 : 0,
		revocationUsability: !result.checks.revokedUsable ? 5 : 0,
		humanReview: result.consentDecision.operatorReview.required ? 4 : 0,
	};
	const weights = {
		purposeAndScope: 0.2,
		selectiveDisclosure: 0.25,
		signatureIntegrity: 0.25,
		revocationUsability: 0.2,
		humanReview: 0.1,
	};
	const finalScore = weightedScore(scores, weights);

	return {
		id: "scorecard-citizen-data-wallet-001",
		createdAt: ISSUED_AT,
		scale: 5,
		gate: finalScore >= 4.5 ? "continue" : "needs-human-review",
		finalScore,
		scores,
		weights,
		thresholds: {
			continue: 4.5,
			needsHumanReview: 3.5,
			doNotScaleBelow: 3.5,
		},
		limits: [
			"Synthetic signature and attribute flow only; no standards conformance is claimed.",
			"Production adoption requires accessibility, legal, and service-integration review.",
		],
	};
}

export function buildRiskAndStandardsMatrix(result) {
	return {
		id: "risk-and-standards-citizen-data-wallet-001",
		createdAt: ISSUED_AT,
		conformanceClaim: false,
		frameworks: [
			{
				id: "w3c-vc-openid-direction",
				name: "W3C VC and OpenID credential flow direction",
				stance: "architecture-alignment",
				note:
					"This POC uses inspired local receipts and signatures; it does not claim VC, OpenID4VP, or OpenID4VCI conformance.",
			},
			{
				id: "privacy-minimization",
				name: "Privacy and data minimization",
				stance: "control-pressure",
				note:
					"Purpose, requested attributes, selective disclosure, and revocation are explicit review artefacts.",
			},
		],
		controls: [
			{
				id: "purpose-and-scope",
				risk: "service collects attributes without a clear purpose",
				evidence: ["service-request.json", "authorization-receipt.json"],
				status: result.request.purpose ? "demonstrated" : "needs-work",
			},
			{
				id: "selective-disclosure",
				risk: "wallet discloses attributes outside the authorization scope",
				evidence: ["selective-presentation.json", "consent-decision.json"],
				status:
					result.consentDecision.presentation.unrequestedDisclosures.length === 0
						? "demonstrated"
						: "needs-work",
			},
			{
				id: "revocation",
				risk: "revoked authorization remains usable",
				evidence: ["revocation-event.json", "consent-decision.json"],
				status: !result.checks.revokedUsable ? "demonstrated" : "needs-work",
			},
		],
		gaps: [
			{
				id: "standards-test-suite",
				neededForClaim: "VC or OpenID conformance",
				nextEvidence: "Run a dedicated standards test suite against real protocol messages.",
			},
			{
				id: "accessibility-service-integration",
				neededForClaim: "production service readiness",
				nextEvidence: "Exercise a real UI journey with accessibility and service-integration tests.",
			},
			{
				id: "legal-review",
				neededForClaim: "legal or institutional compliance",
				nextEvidence: "Attach a qualified legal or institutional review outside this POC.",
			},
		],
	};
}

function evidenceForWalletCriterion(criterion) {
	const evidence = {
		purposeAndScope: "Service request and receipt carry purpose, scope, and expiration.",
		selectiveDisclosure: "Presentation exposes only requested attributes.",
		signatureIntegrity: "Signature verifies and tampered payload fails verification.",
		revocationUsability: "Revocation changes authorization status to unusable.",
		humanReview: "Consent decision requires operator review.",
	};
	return evidence[criterion] ?? "Synthetic wallet evidence.";
}

export function runWalletPoc() {
	const identity = createIdentity();
	const attributes = createAuthorityAttributes();
	const request = createServiceRequest();
	const authorization = createAuthorizationReceipt(request);
	const presentation = createSelectivePresentation(attributes, authorization);
	const revocation = createRevocationEvent(authorization);
	const consentDecision = createConsentDecision({
		request,
		authorization,
		presentation,
		revocation,
	});
	const tamperedPayload = {
		...authorizationPayload(authorization),
		scope: [...authorization.scope, "municipio"],
	};

	return {
		identity,
		attributes,
		request,
		authorization,
		presentation,
		revocation,
		consentDecision,
		checks: {
			signatureValid: verifyPayloadSignature(
				authorizationPayload(authorization),
				authorization.proof.signature,
			),
			tamperedSignatureValid: verifyPayloadSignature(
				tamperedPayload,
				authorization.proof.signature,
			),
			revokedUsable: revocation.statusAfter !== "revoked",
		},
	};
}

export function buildTaskArtefactManifest(writtenArtifacts) {
	const roles = {
		"identity.json": "receipt",
		"authority-attributes.json": "dataset",
		"service-request.json": "receipt",
		"authorization-receipt.json": "receipt",
		"selective-presentation.json": "receipt",
		"revocation-event.json": "receipt",
		"consent-decision.json": "receipt",
		"scorecard.json": "report",
		"risk-and-standards-matrix.json": "report",
		"scenario.md": "report",
		"annex.md": "report",
		"audit-trail.md": "audit-trail",
	};
	const labels = {
		"scorecard.json": ["scorecard", "pilot"],
		"risk-and-standards-matrix.json": ["risk", "standards", "claim-promotion"],
		"scenario.md": ["scenario", "reader-path"],
		"annex.md": ["annex", "evidence-map"],
	};

	return {
		schema: TASK_ARTEFACTS_SCHEMA,
		taskId: TASK_ID,
		effortId: EFFORT_ID,
		createdAt: ISSUED_AT,
		artefacts: Object.entries(writtenArtifacts).map(([fileName, contents]) => ({
			id: fileName.replace(/\.[^.]+$/, ""),
			uri: fileName,
			mediaType: fileName.endsWith(".md") ? "text/markdown" : "application/json",
			role: roles[fileName] ?? "other",
			hash: {
				algorithm: "sha256",
				value: sha256Text(contents),
			},
			reviewState: "accepted",
			provenance: {
				runId: RUN_ID,
				producer: "wallet:poc",
				command: "pnpm run wallet:poc",
				source: "validations/citizen-data-wallet-poc",
				sourceVersion: "synthetic-v1",
				producedAt: ISSUED_AT,
			},
			...(labels[fileName] ? { labels: labels[fileName] } : {}),
		})),
	};
}

export function writeArtifacts(outDir) {
	const result = runWalletPoc();
	const scorecard = buildPilotScorecard(result);
	const riskAndStandardsMatrix = buildRiskAndStandardsMatrix(result);
	const artifacts = {
		"identity.json": result.identity,
		"authority-attributes.json": result.attributes,
		"service-request.json": result.request,
		"authorization-receipt.json": result.authorization,
		"selective-presentation.json": result.presentation,
		"revocation-event.json": result.revocation,
		"consent-decision.json": result.consentDecision,
		"scorecard.json": scorecard,
		"risk-and-standards-matrix.json": riskAndStandardsMatrix,
	};
	const auditTrail = buildAuditTrail({
		attributes: result.attributes,
		request: result.request,
		presentation: result.presentation,
		revocation: result.revocation,
	});
	const writtenArtifacts = {
		...Object.fromEntries(
			Object.entries(artifacts).map(([fileName, value]) => [fileName, jsonText(value)]),
		),
		"scenario.md": buildScenarioMarkdown(result),
		"annex.md": buildAnnexMarkdown(result, scorecard),
		"audit-trail.md": auditTrail,
	};
	const manifest = buildTaskArtefactManifest(writtenArtifacts);

	mkdirSync(outDir, { recursive: true });
	for (const [fileName, contents] of Object.entries(writtenArtifacts)) {
		writeFileSync(path.join(outDir, fileName), contents);
	}
	writeFileSync(path.join(outDir, "task-artefacts.json"), jsonText(manifest));
	return result;
}

function weightedScore(scores, weights) {
	const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
	const total = Object.entries(scores).reduce(
		(sum, [key, score]) => sum + score * (weights[key] ?? 0),
		0,
	);
	return Math.round((total / totalWeight) * 100) / 100;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const outDir =
		process.argv[2] ??
		path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "expected");
	const result = writeArtifacts(outDir);
	console.log(
		JSON.stringify(
			{
				ok: true,
				outDir,
				attributesAvailable: Object.keys(result.attributes.attributes).length,
				attributesRequested: result.request.requestedAttributes.length,
				attributesPresented: Object.keys(result.presentation.attributes).length,
				signatureValid: result.checks.signatureValid,
				tamperedSignatureValid: result.checks.tamperedSignatureValid,
				revokedUsable: result.checks.revokedUsable,
			},
			null,
			2,
		),
	);
}
