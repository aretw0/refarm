import { describe, expect, it } from "vitest";

import { readLegacyCredentials } from "./migrate.js";
import { readCredentialAt } from "./read-credential.js";
import { credentialSecretLocation } from "./secret-location.js";

const LEGACY_TOKENS = {
	oauthCredentials: { "openai-codex": { access: "T", refresh: "R", expires: 1 } },
};

const legacyLocation = (provider: string) =>
	credentialSecretLocation(readLegacyCredentials(LEGACY_TOKENS).find((a) => a.provider === provider)!);

/**
 * THE DUAL-READ, exercised. `credentialSecretLocation` says WHERE; this says what is there, in the
 * three states a caller has to tell apart. Reading them as two is how a working credential gets
 * reported missing, and how an operator is sent to authenticate over material that was fine.
 */
describe("readCredentialAt", () => {
	it("reads a legacy credential out of the flat token map", () => {
		const result = readCredentialAt(legacyLocation("openai-codex"), {
			legacyOauthCredentials: LEGACY_TOKENS.oauthCredentials,
		});
		expect(result).toMatchObject({ kind: "found" });
		expect((result as { credential: { access: string } }).credential.access).toBe("T");
	});

	it("reads a namespaced credential through the loader it was given", () => {
		const result = readCredentialAt(
			{ kind: "namespaced", namespace: "model", id: "model-account:X" },
			{ namespacedSecret: (ns, id) => (ns === "model" && id === "model-account:X" ? { access: "N" } : undefined) },
		);
		expect(result).toMatchObject({ kind: "found" });
		expect((result as { credential: { access: string } }).credential.access).toBe("N");
	});

	it("says ABSENT when the place exists and holds nothing", () => {
		expect(readCredentialAt(legacyLocation("openai-codex"), { legacyOauthCredentials: {} })).toMatchObject(
			{ kind: "absent" },
		);
	});

	it("says UNREADABLE when no loader was supplied, which is not the same as absent", () => {
		// A caller that cannot reach the namespaced store has not established that the credential is
		// missing. Reporting `absent` would invite a re-login over a credential that exists.
		expect(
			readCredentialAt({ kind: "namespaced", namespace: "model", id: "x" }, {}),
		).toMatchObject({ kind: "unreadable" });
	});

	it("says UNREADABLE for a location it does not understand", () => {
		expect(
			readCredentialAt({ kind: "unknown", secretRef: "vault://elsewhere" }, {}),
		).toMatchObject({ kind: "unreadable" });
	});

	it("treats a non-object credential as unreadable rather than as found", () => {
		// A slot holding a bare string is something, and it is not a credential this build can use.
		expect(
			readCredentialAt(legacyLocation("openai-codex"), {
				legacyOauthCredentials: { "openai-codex": "a string" },
			}),
		).toMatchObject({ kind: "unreadable" });
	});
});
