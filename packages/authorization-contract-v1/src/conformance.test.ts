import { describe, expect, it } from "vitest";

import { runAuthorizationV1Conformance } from "./conformance.js";
import { createInMemoryAuthorizationProviderFixture } from "./in-memory.js";
import { createReferenceAuthorizationProvider } from "./reference.js";
import { AUTHORIZATION_CAPABILITY, type ServiceRequest } from "./types.js";

const request: ServiceRequest = {
	id: "req-1",
	requester: "service-x",
	subject: "holder-1",
	purpose: "check eligibility",
	requestedAttributes: ["faixa_etaria", "vinculo"],
	expiresAt: "2999-01-01T00:00:00.000Z",
};

const attributes = {
	subject: "holder-1",
	issuer: "issuer-1",
	issuedAt: "2026-01-01T00:00:00.000Z",
	attributes: { nome_social: "Fulano", faixa_etaria: "30-39", municipio: "Cidade", vinculo: "servidor" },
};

describe("authorization:v1 conformance", () => {
	it("the in-memory reference provider passes the full journey suite", async () => {
		const { provider } = createInMemoryAuthorizationProviderFixture();
		const result = await runAuthorizationV1Conformance(provider);
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});
});

describe("ReferenceAuthorizationProvider — journey invariants", () => {
	const build = () => createInMemoryAuthorizationProviderFixture({ holderId: "holder-1" }).provider;

	it("authorize copies purpose/scope and signs (status active)", async () => {
		const provider = build();
		expect(provider.capability).toBe(AUTHORIZATION_CAPABILITY);
		const receipt = await provider.authorize(request);
		expect(receipt.purpose).toBe("check eligibility");
		expect(receipt.scope).toEqual(["faixa_etaria", "vinculo"]);
		expect(receipt.status).toBe("active");
		expect(receipt.proof.signature).toBeTruthy();
	});

	it("present discloses only the authorized attributes", async () => {
		const provider = build();
		const receipt = await provider.authorize(request);
		const presentation = await provider.present(receipt, attributes);
		expect(Object.keys(presentation.attributes).sort()).toEqual(["faixa_etaria", "vinculo"]);
		expect(presentation.attributes).not.toHaveProperty("nome_social");
		expect(presentation.attributes).not.toHaveProperty("municipio");
	});

	it("verify detects a tampered payload", async () => {
		const provider = build();
		const receipt = await provider.authorize(request);
		const tampered = { ...receipt, scope: [...receipt.scope, "nome_social"] };
		const result = await provider.verify(tampered);
		expect(result.valid).toBe(false);
		expect(result.checks.signature?.ok).toBe(false);
	});

	it("verify flags an out-of-scope presentation", async () => {
		const provider = build();
		const receipt = await provider.authorize(request);
		const badPresentation = {
			id: "p",
			holder: "holder-1",
			requester: "service-x",
			authorizationId: receipt.id,
			presentedAt: "2026-01-01T00:00:00.000Z",
			attributes: { faixa_etaria: "30-39", nome_social: "leaked" },
		};
		const result = await provider.verify(receipt, badPresentation);
		expect(result.valid).toBe(false);
		expect(result.checks.scope?.ok).toBe(false);
	});

	it("revoke makes the authorization unusable", async () => {
		const provider = build();
		const receipt = await provider.authorize(request);
		const { event, receipt: revoked } = await provider.revoke(receipt, "citizen withdrew consent");
		expect(event.statusBefore).toBe("active");
		expect(event.statusAfter).toBe("revoked");
		expect(revoked.status).toBe("revoked");
		const verified = await provider.verify(revoked);
		expect(verified.valid).toBe(false);
		expect(verified.checks["not-revoked"]?.ok).toBe(false);
		await expect(provider.present(revoked, attributes)).rejects.toThrow();
	});

	it("verify flags an expired authorization", async () => {
		// A provider whose clock is AFTER the request's expiry.
		const provider = createReferenceAuthorizationProvider({
			signer: createInMemoryAuthorizationProviderFixture().signer,
			holderId: "holder-1",
			now: () => new Date("3000-01-01T00:00:00.000Z"),
		});
		const receipt = await provider.authorize({ ...request, expiresAt: "2026-02-01T00:00:00.000Z" });
		const verified = await provider.verify(receipt);
		expect(verified.checks["not-expired"]?.ok).toBe(false);
		expect(verified.valid).toBe(false);
	});
});
