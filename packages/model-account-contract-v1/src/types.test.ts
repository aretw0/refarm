import { describe, expect, it } from "vitest";

import { newCredentialId, REFUSAL_CODES } from "./types.js";

describe("newCredentialId", () => {
	it("is opaque and prefixed, so a reader cannot mistake it for an alias", () => {
		// D1: the id is "generated, node-local, stable, and semantically opaque". An id that read as
		// a login or an alias would invite exactly the branching D1 forbids.
		const id = newCredentialId("seed-1");
		expect(id).toMatch(/^model-account:[0-9A-Z]{26}$/u);
	});

	it("is STABLE for a seed, so a rename cannot change it", () => {
		// The acceptance row "rename blue to client-x → opaque id, binding, secret and history are
		// unchanged" only holds if the id never derives from the alias.
		expect(newCredentialId("seed-1")).toBe(newCredentialId("seed-1"));
		expect(newCredentialId("seed-1")).not.toBe(newCredentialId("seed-2"));
	});

	it("does not leak its seed", () => {
		// A seed may be a provider subject. The id travels into logs, status and budget exports,
		// where the spec allows "safe credential id only; no token, email, or GitHub login".
		expect(newCredentialId("github:12345")).not.toContain("12345");
		expect(newCredentialId("github:12345")).not.toContain("github");
	});
});

describe("REFUSAL_CODES", () => {
	it("names the ambiguity refusal exactly as the spec's acceptance matrix does", () => {
		// Consumers assert on this string. It is a contract, not a message.
		expect(REFUSAL_CODES.ambiguous).toBe("model_credential_ambiguous");
	});

	it("separates the three unusable states, which are not one state", () => {
		expect(new Set(Object.values(REFUSAL_CODES)).size).toBe(Object.values(REFUSAL_CODES).length);
		expect(REFUSAL_CODES).toMatchObject({
			ambiguous: "model_credential_ambiguous",
			none: "model_credential_none",
			incomplete: "model_credential_incomplete",
			unclaimed: "model_credential_unclaimed",
		});
	});
});
