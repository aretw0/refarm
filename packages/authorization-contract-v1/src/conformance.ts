import {
	AUTHORIZATION_CAPABILITY,
	type AuthorizationConformanceResult,
	type AuthorizationProvider,
	type AttributeSet,
	type ServiceRequest,
} from "./types.js";

function conformanceRequest(): ServiceRequest {
	return {
		id: "request-conformance-001",
		requester: "service-conformance",
		subject: "holder-conformance",
		purpose: "verify eligibility for a synthetic conformance check",
		requestedAttributes: ["faixa_etaria", "vinculo"],
		expiresAt: "2999-01-01T00:00:00.000Z",
	};
}

function conformanceAttributes(): AttributeSet {
	return {
		subject: "holder-conformance",
		issuer: "issuer-conformance",
		issuedAt: "2026-01-01T00:00:00.000Z",
		attributes: {
			nome_social: "Fulano Sintetico",
			faixa_etaria: "30-39",
			municipio: "Cidade Ficticia",
			vinculo: "servidor-ficticio",
		},
	};
}

/**
 * Run the authorization:v1 conformance suite against any provider: the full journey plus
 * the invariants a caller relies on — purpose/scope carried, selective disclosure minimal,
 * signature tamper-detected, revocation makes the receipt unusable.
 */
export async function runAuthorizationV1Conformance(
	provider: AuthorizationProvider,
): Promise<AuthorizationConformanceResult> {
	const failures: string[] = [];
	const check = (name: string, ok: boolean) => {
		if (!ok) failures.push(name);
	};

	check("capability is authorization:v1", provider.capability === AUTHORIZATION_CAPABILITY);

	const request = conformanceRequest();
	const attributes = conformanceAttributes();

	const receipt = await provider.authorize(request);
	check("authorize carries the purpose", receipt.purpose === request.purpose);
	check(
		"authorize carries the scope",
		JSON.stringify(receipt.scope) === JSON.stringify(request.requestedAttributes),
	);
	check("authorize is active", receipt.status === "active");
	check("authorize is signed", Boolean(receipt.proof?.signature));

	const verified = await provider.verify(receipt);
	check("a fresh authorization verifies", verified.valid);

	const presentation = await provider.present(receipt, attributes);
	const presentedKeys = Object.keys(presentation.attributes).sort();
	check(
		"presentation discloses only the scope",
		JSON.stringify(presentedKeys) === JSON.stringify([...request.requestedAttributes].sort()),
	);
	check(
		"presentation does not leak an out-of-scope attribute",
		!("nome_social" in presentation.attributes),
	);
	const presentationVerified = await provider.verify(receipt, presentation);
	check("presentation verifies in scope", presentationVerified.valid);

	// Tamper: a modified payload must fail signature verification.
	const tampered = { ...receipt, scope: [...receipt.scope, "nome_social"] };
	const tamperedVerified = await provider.verify(tampered);
	check("a tampered authorization fails verification", !tamperedVerified.valid);
	check(
		"the failed check is the signature",
		tamperedVerified.checks.signature?.ok === false,
	);

	// Revocation: after revoke, the receipt is no longer usable.
	const { event, receipt: revoked } = await provider.revoke(receipt, "conformance revocation");
	check("revocation records the transition", event.statusBefore === "active" && event.statusAfter === "revoked");
	check("revoked receipt has revoked status", revoked.status === "revoked");
	const revokedVerified = await provider.verify(revoked);
	check("a revoked authorization does not verify", !revokedVerified.valid);
	check("the failed check is not-revoked", revokedVerified.checks["not-revoked"]?.ok === false);
	let presentAfterRevokeRejected = false;
	try {
		await provider.present(revoked, attributes);
	} catch {
		presentAfterRevokeRejected = true;
	}
	check("presenting a revoked authorization is rejected", presentAfterRevokeRejected);

	const total = 15;
	return { pass: failures.length === 0, total, failed: failures.length, failures };
}
