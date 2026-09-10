import { describe, expect, it } from "vitest";

import { readLegacyCredentials } from "./migrate.js";
import { credentialSecretLocation, LEGACY_REF_PREFIX } from "./secret-location.js";
import type { ModelAccountDescriptor } from "./types.js";

const account = (overrides: Partial<ModelAccountDescriptor> = {}): ModelAccountDescriptor => ({
	credentialId: "model-account:AAAAAAAAAAAAAAAAAAAAAAAAAA",
	provider: "github-copilot",
	alias: "blue",
	identity: { status: "unverified" },
	secretRef: "model/model-account:AAAAAAAAAAAAAAAAAAAAAAAAAA",
	health: "healthy",
	revision: "sha256:r1",
	...overrides,
});

/**
 * THE DUAL-READ PERIOD, made explicit in one place.
 *
 * The spec's migration forbids dual-WRITING a secret value, so a new login writes only to the
 * namespaced store while every credential stored before it stays in the flat `oauthCredentials`
 * map. Both must remain readable for as long as both exist, and the alternative to this function is
 * that knowledge spreading across four call sites, each guessing.
 */
describe("credentialSecretLocation", () => {
	it("sends a namespaced descriptor to the silo namespace and its id", () => {
		expect(credentialSecretLocation(account())).toEqual({
			kind: "namespaced",
			namespace: "model",
			id: "model-account:AAAAAAAAAAAAAAAAAAAAAAAAAA",
		});
	});

	it("sends a LEGACY descriptor to the flat token map, naming the provider key", () => {
		// The legacy secret is NOT in the `model` namespace. Reading it there finds nothing, and the
		// caller would report a working credential as missing.
		const [codex] = readLegacyCredentials({ oauthCredentials: { "openai-codex": { access: "T" } } });
		expect(credentialSecretLocation(codex!)).toEqual({
			kind: "legacy",
			provider: "openai-codex",
		});
	});

	it("marks the legacy ref so its location is self-describing, not inferred", () => {
		// `revision: "sha256:legacy"` would also identify it, and would be the wrong thing to key on:
		// a revision changes when the credential changes, and a location must not.
		const [codex] = readLegacyCredentials({ oauthCredentials: { "openai-codex": { access: "T" } } });
		expect(codex?.secretRef).toBe(`${LEGACY_REF_PREFIX}openai-codex`);
	});

	it("refuses to guess for a ref shape it does not recognise", () => {
		// THREE STATES. A descriptor written by a newer refarm, or corrupted, must not be read as
		// either store — loading the wrong one returns "no credential" for a credential that exists.
		expect(credentialSecretLocation(account({ secretRef: "vault://elsewhere" }))).toEqual({
			kind: "unknown",
			secretRef: "vault://elsewhere",
		});
	});
});
