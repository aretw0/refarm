import { describe, expect, it } from "vitest";

import {
	CONSENT_AUTHORIZE_ACTION_ID,
	CONSENT_REVOKE_ACTION_ID,
	renderAuthorizationConsentCard,
	renderAuthorizationList,
	renderConsentPrompt,
} from "./render.js";
import type { AuthorizationReceipt, ServiceRequest } from "./types.js";

const activeReceipt: AuthorizationReceipt = {
	id: "authz-1",
	holder: "citizen-1",
	requester: "servico-beneficio",
	purpose: "verificar elegibilidade",
	scope: ["faixa_etaria", "vinculo"],
	issuedAt: "2026-01-01T00:00:00.000Z",
	expiresAt: "2027-01-01T00:00:00.000Z",
	status: "active",
	proof: { type: "t", algorithm: "a", signature: "sig" },
};

const request: ServiceRequest = {
	id: "req-1",
	requester: "servico-beneficio",
	subject: "citizen-1",
	purpose: "verificar elegibilidade",
	requestedAttributes: ["faixa_etaria", "vinculo"],
	expiresAt: "2027-01-01T00:00:00.000Z",
};

describe("renderAuthorizationConsentCard", () => {
	it("shows requester, purpose, scope chips, and a revoke control while active", () => {
		const html = renderAuthorizationConsentCard(activeReceipt);
		expect(html).toContain("servico-beneficio");
		expect(html).toContain("verificar elegibilidade");
		expect(html).toContain("faixa_etaria");
		expect(html).toContain("vinculo");
		expect(html).toContain(`data-refarm-surface-action-id="${CONSENT_REVOKE_ACTION_ID}"`);
		expect(html).toContain('data-authorization-status="active"');
	});

	it("does not offer revoke once revoked, and shows the revoked badge", () => {
		const html = renderAuthorizationConsentCard({ ...activeReceipt, status: "revoked" });
		expect(html).not.toContain(CONSENT_REVOKE_ACTION_ID);
		expect(html).toContain("Revogada");
	});

	it("escapes the requester/purpose to prevent injection", () => {
		const html = renderAuthorizationConsentCard({
			...activeReceipt,
			requester: "<script>x</script>",
		});
		expect(html).not.toContain("<script>x</script>");
		expect(html).toContain("&lt;script&gt;");
	});
});

describe("renderConsentPrompt", () => {
	it("renders the T2-F7 consent moment with authorize/decline controls", () => {
		const html = renderConsentPrompt(request);
		expect(html).toContain(`data-refarm-surface-action-id="${CONSENT_AUTHORIZE_ACTION_ID}"`);
		expect(html).toContain("Autorizar");
		expect(html).toContain("Recusar");
		expect(html).toContain("faixa_etaria");
	});
});

describe("renderAuthorizationList", () => {
	it("is empty when nothing is authorized", () => {
		expect(renderAuthorizationList([])).toBe("");
	});

	it("orders active before revoked (the before/after history)", () => {
		const html = renderAuthorizationList([
			{ ...activeReceipt, id: "revoked-1", status: "revoked" },
			{ ...activeReceipt, id: "active-1", status: "active" },
		]);
		expect(html.indexOf("active-1")).toBeLessThan(html.indexOf("revoked-1"));
	});

	it("uses a translator when provided", () => {
		const html = renderAuthorizationList([activeReceipt], {
			t: (key) => (key === "authorization/list_title" ? "My authorizations" : key),
		});
		expect(html).toContain("My authorizations");
	});
});
