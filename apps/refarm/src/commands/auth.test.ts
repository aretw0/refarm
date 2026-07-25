import { describe, expect, it } from "vitest";

import type { AuthPolicyFile } from "./auth.js";
import { sha256Hex, upsertCredential } from "./auth.js";

describe("refarm auth — credential policy", () => {
	it("sha256Hex matches the digest the daemon stores (lowercase hex)", () => {
		// Known vector: sha256("test-device-token")
		expect(sha256Hex("test-device-token")).toMatch(/^[0-9a-f]{64}$/);
		expect(sha256Hex("a")).toBe(sha256Hex("a"));
		expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
	});

	it("upsertCredential adds a new identity without touching others", () => {
		const policy: AuthPolicyFile = { credentials: [{ identity: "spouse", tokenSha256: "s" }] };
		const next = upsertCredential(policy, "arthur", "a", false);
		expect(next.credentials).toEqual([
			{ identity: "spouse", tokenSha256: "s" },
			{ identity: "arthur", tokenSha256: "a" },
		]);
		// pure — original untouched
		expect(policy.credentials).toHaveLength(1);
	});

	it("upsertCredential refuses to clobber an enrolled identity without --rotate", () => {
		const policy: AuthPolicyFile = { credentials: [{ identity: "arthur", tokenSha256: "old" }] };
		expect(() => upsertCredential(policy, "arthur", "new", false)).toThrow(/already enrolled/);
	});

	it("upsertCredential rotates an existing identity's token when asked", () => {
		const policy: AuthPolicyFile = { credentials: [{ identity: "arthur", tokenSha256: "old" }] };
		const next = upsertCredential(policy, "arthur", "new", true);
		expect(next.credentials).toEqual([{ identity: "arthur", tokenSha256: "new" }]);
	});

	it("preserves Slice-2 fields (workspaces/memberships) verbatim", () => {
		const policy: AuthPolicyFile = {
			credentials: [],
			workspaces: [{ id: "personal-arthur", kind: "personal", namespace: "personal-arthur" }],
		};
		const next = upsertCredential(policy, "arthur", "a", false);
		expect(next.workspaces).toEqual(policy.workspaces);
	});
});
