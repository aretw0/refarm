import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
	addScopedCredential,
	authenticateScopedToken,
	clampScopedLifetime,
	DEFAULT_SCOPED_LIFETIME_MS,
	describeScopeForOperator,
	isScopedCredentialExpired,
	MAX_SCOPED_LIFETIME_MS,
	parseScopedCredential,
	pruneExpiredScopedCredentials,
	readScopedCredentials,
	removeScopedCredential,
	SCOPE_ANSWER_PROMPTS,
	SCOPE_READ_OPERATIONS,
	SCOPE_START_OPERATIONS,
	SCOPED_CREDENTIAL_WIRE,
	unknownScope,
	type ScopedCredential,
} from "./scoped-credential.js";

const NOW = 1_700_000_000_000;

it("keeps the scope constants aligned with the cross-runtime fixture", async () => {
	const fixture = JSON.parse(
		await readFile(new URL("../scopes.fixture.json", import.meta.url), "utf8"),
	) as { scopes: string[] };
	expect(fixture.scopes).toEqual([
		SCOPE_ANSWER_PROMPTS,
		SCOPE_READ_OPERATIONS,
		SCOPE_START_OPERATIONS,
	]);
});

function credential(overrides: Partial<ScopedCredential> = {}): ScopedCredential {
	return {
		wire: SCOPED_CREDENTIAL_WIRE,
		id: "sas-1",
		identity: "web-session",
		tokenSha256: "a".repeat(64),
		scope: [SCOPE_ANSWER_PROMPTS],
		surface: "web",
		issuedVia: "emoji-sas.v1",
		issuedAt: NOW,
		expiresAt: NOW + DEFAULT_SCOPED_LIFETIME_MS,
		...overrides,
	};
}

describe("S3 — a scoped credential is NOT a device credential", () => {
	it("never lands in `credentials[]`, which is the only array the Rust gate reads", () => {
		// THE guarantee, and the reason it is structural rather than a promise.
		//
		// `packages/tractor/src/sidecar/auth.rs` deserializes ONLY `credentials[]`, into
		// `{ identity, tokenSha256 }`, and its `authenticate()` has no scope check and no
		// clock. An entry placed there would be honoured as a full device credential for
		// every sidecar route, forever — the browser holding the device token with extra
		// steps. Placing it under a key that parser never reads is what makes "not a
		// device credential" true on the other side of the file.
		const policy = addScopedCredential(
			{ credentials: [{ identity: "phone", tokenSha256: "b".repeat(64) }] },
			credential(),
		);
		expect(policy.credentials).toEqual([{ identity: "phone", tokenSha256: "b".repeat(64) }]);
		expect(Array.isArray(policy.scopedCredentials)).toBe(true);
		expect(JSON.stringify(policy.credentials)).not.toContain("sas-1");
	});

	it("carries every other key through verbatim, so an enrol/revoke round trip is lossless", () => {
		const policy = addScopedCredential(
			{ credentials: [], workspaces: { farm: ["phone"] }, somethingLater: 42 },
			credential(),
		);
		expect(policy.workspaces).toEqual({ farm: ["phone"] });
		expect(policy.somethingLater).toBe(42);
	});

	it("always expires — there is no way to write one that does not", () => {
		const parsed = parseScopedCredential({ ...credential(), expiresAt: null });
		expect(parsed).toBeNull();
		expect(isScopedCredentialExpired(credential({ expiresAt: NOW - 1 }), NOW)).toBe(true);
		expect(isScopedCredentialExpired(credential({ expiresAt: NOW + 1 }), NOW)).toBe(false);
	});

	it("a browser session's default lifetime is visibly shorter than an enrolment's", () => {
		// A device enrolment has NO expiry at all in the policy the daemon reads; this
		// one is measured in an hour. S3 asks for the difference to be visible in the
		// lifetime rather than asserted in prose.
		expect(DEFAULT_SCOPED_LIFETIME_MS).toBe(60 * 60 * 1000);
		expect(clampScopedLifetime(undefined)).toBe(DEFAULT_SCOPED_LIFETIME_MS);
		expect(clampScopedLifetime(5_000)).toBe(5_000);
		expect(clampScopedLifetime(MAX_SCOPED_LIFETIME_MS * 10)).toBe(MAX_SCOPED_LIFETIME_MS);
		expect(clampScopedLifetime(-1)).toBe(DEFAULT_SCOPED_LIFETIME_MS);
	});
});

describe("the gate over a scoped credential", () => {
	const policy = addScopedCredential({ credentials: [] }, credential());

	it("admits the right hash, with the right scope, before the deadline", () => {
		expect(authenticateScopedToken(policy, "a".repeat(64), SCOPE_ANSWER_PROMPTS, NOW)?.id).toBe(
			"sas-1",
		);
	});

	it("refuses an unknown hash", () => {
		expect(authenticateScopedToken(policy, "c".repeat(64), SCOPE_ANSWER_PROMPTS, NOW)).toBeNull();
	});

	it("refuses a scope the credential does not hold", () => {
		expect(authenticateScopedToken(policy, "a".repeat(64), "sidecar:call", NOW)).toBeNull();
	});

	it("refuses after the deadline — expiry is ENFORCED, not merely recorded", () => {
		expect(
			authenticateScopedToken(
				policy,
				"a".repeat(64),
				SCOPE_ANSWER_PROMPTS,
				NOW + DEFAULT_SCOPED_LIFETIME_MS,
			),
		).toBeNull();
		expect(
			authenticateScopedToken(
				policy,
				"a".repeat(64),
				SCOPE_ANSWER_PROMPTS,
				NOW + DEFAULT_SCOPED_LIFETIME_MS + 1,
			),
		).toBeNull();
	});

	it("matches case-insensitively on the hex digest, and refuses a blank one", () => {
		expect(authenticateScopedToken(policy, "A".repeat(64), SCOPE_ANSWER_PROMPTS, NOW)?.id).toBe(
			"sas-1",
		);
		expect(authenticateScopedToken(policy, "   ", SCOPE_ANSWER_PROMPTS, NOW)).toBeNull();
	});
});

describe("individually revocable (S3)", () => {
	const two = addScopedCredential(
		addScopedCredential({ credentials: [] }, credential()),
		credential({ id: "sas-2", identity: "web-session", tokenSha256: "d".repeat(64) }),
	);

	it("revokes ONE by id, leaving its sibling and every device credential alone", () => {
		const withDevice = {
			...two,
			credentials: [{ identity: "phone", tokenSha256: "b".repeat(64) }],
		};
		const { policy, removed } = removeScopedCredential(withDevice, "sas-1");
		expect(removed.id).toBe("sas-1");
		expect(readScopedCredentials(policy).map((c) => c.id)).toEqual(["sas-2"]);
		expect(policy.credentials).toEqual([{ identity: "phone", tokenSha256: "b".repeat(64) }]);
	});

	it("refuses an AMBIGUOUS identity rather than picking one", () => {
		// Two browser sessions carry the same human label. Picking "the first" would cut
		// off a session the operator did not name and leave the one they meant running.
		expect(() => removeScopedCredential(two, "web-session")).toThrow(/names 2 scoped credentials/);
	});

	it("revokes by identity when it is unambiguous", () => {
		const one = addScopedCredential({ credentials: [] }, credential());
		expect(removeScopedCredential(one, "web-session").removed.id).toBe("sas-1");
	});

	it("refuses to report success for something that was never there", () => {
		expect(() => removeScopedCredential({ credentials: [] }, "sas-9")).toThrow(/nothing to revoke/);
	});

	it("refuses a duplicate id", () => {
		expect(() => addScopedCredential(two, credential({ id: "sas-2" }))).toThrow(/already exists/);
	});
});

describe("reading a policy off disk", () => {
	it("drops entries that do not parse without losing the ones that do", () => {
		const policy = {
			credentials: [],
			scopedCredentials: [credential(), { nonsense: true }, null, credential({ id: "sas-3" })],
		};
		expect(readScopedCredentials(policy).map((c) => c.id)).toEqual(["sas-1", "sas-3"]);
	});

	it("treats a missing or non-array key as no scoped credentials", () => {
		expect(readScopedCredentials({ credentials: [] })).toEqual([]);
		expect(readScopedCredentials({ scopedCredentials: "nope" })).toEqual([]);
	});

	it("refuses an entry with an empty scope — authority by omission is not a thing", () => {
		expect(parseScopedCredential({ ...credential(), scope: [] })).toBeNull();
	});

	it("refuses an entry without the wire tag", () => {
		const { wire: _wire, ...untagged } = credential();
		expect(parseScopedCredential(untagged)).toBeNull();
	});
});

describe("housekeeping and vocabulary", () => {
	it("prunes only what has expired, and says what it swept", () => {
		const policy = addScopedCredential(
			addScopedCredential({ credentials: [] }, credential({ expiresAt: NOW - 1 })),
			credential({ id: "sas-2", expiresAt: NOW + 10_000 }),
		);
		const { policy: pruned, expired } = pruneExpiredScopedCredentials(policy, NOW);
		expect(expired.map((c) => c.id)).toEqual(["sas-1"]);
		expect(readScopedCredentials(pruned).map((c) => c.id)).toEqual(["sas-2"]);
		expect(pruneExpiredScopedCredentials(pruned, NOW).expired).toEqual([]);
	});

	it("names an unknown scope rather than silently narrowing it", () => {
		expect(
			unknownScope([SCOPE_ANSWER_PROMPTS, SCOPE_READ_OPERATIONS, SCOPE_START_OPERATIONS]),
		).toBeNull();
		expect(unknownScope([SCOPE_ANSWER_PROMPTS, "sidecar:call"])).toBe("sidecar:call");
	});

	it("describes the scope in words the operator can act on", () => {
		expect(describeScopeForOperator([SCOPE_ANSWER_PROMPTS])[0]).toContain(
			"may answer operator prompts",
		);
		expect(describeScopeForOperator([SCOPE_READ_OPERATIONS])[0]).toContain("read their lifecycle");
		expect(describeScopeForOperator([SCOPE_START_OPERATIONS])[0]).toContain("already admitted");
	});
});
