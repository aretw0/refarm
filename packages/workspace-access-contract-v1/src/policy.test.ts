import { describe, expect, it } from "vitest";

import { resolveAccess, validatePolicy, workspacesFor } from "./policy.js";
import type { AccessPolicy } from "./types.js";

/** The operator's own model: two people, a personal space each, a shared collective. */
const POLICY: AccessPolicy = {
	workspaces: [
		{ id: "personal-arthur", kind: "personal", namespace: "personal-arthur" },
		{ id: "personal-spouse", kind: "personal", namespace: "personal-spouse" },
		{ id: "collective-casa", kind: "collective", namespace: "collective-casa" },
	],
	memberships: [
		{ identity: "id-arthur", workspaces: ["personal-arthur", "collective-casa"] },
		{ identity: "id-spouse", workspaces: ["personal-spouse", "collective-casa"] },
	],
};

describe("workspace-access — resolveAccess", () => {
	it("denies an unknown identity (the gate's core 'who are you')", () => {
		expect(resolveAccess(POLICY, "id-stranger", "collective-casa")).toEqual({
			ok: false,
			reason: "unknown-identity",
		});
	});

	it("grants a member the workspace they requested, with its policy namespace", () => {
		expect(resolveAccess(POLICY, "id-arthur", "personal-arthur")).toEqual({
			ok: true,
			workspace: { id: "personal-arthur", kind: "personal", namespace: "personal-arthur" },
		});
		// both may act in the shared collective
		expect(resolveAccess(POLICY, "id-spouse", "collective-casa")).toEqual({
			ok: true,
			workspace: { id: "collective-casa", kind: "collective", namespace: "collective-casa" },
		});
	});

	it("denies a member reaching into a workspace they don't belong to (isolation)", () => {
		expect(resolveAccess(POLICY, "id-arthur", "personal-spouse")).toEqual({
			ok: false,
			reason: "workspace-not-allowed",
		});
	});

	it("denies a workspace that doesn't exist", () => {
		expect(resolveAccess(POLICY, "id-arthur", "personal-ghost")).toEqual({
			ok: false,
			reason: "workspace-not-found",
		});
	});

	it("never treats a requested id as a namespace — only as a lookup key", () => {
		// A hostile id can't inject a namespace; it just isn't found.
		expect(resolveAccess(POLICY, "id-arthur", "../../etc/passwd")).toEqual({
			ok: false,
			reason: "workspace-not-found",
		});
	});

	it("defaults only when the identity has exactly one workspace", () => {
		const single: AccessPolicy = {
			workspaces: [{ id: "solo", kind: "personal", namespace: "solo" }],
			memberships: [{ identity: "id-solo", workspaces: ["solo"] }],
		};
		expect(resolveAccess(single, "id-solo")).toEqual({
			ok: true,
			workspace: { id: "solo", kind: "personal", namespace: "solo" },
		});
		// Arthur has two → ambiguous → deny rather than guess.
		expect(resolveAccess(POLICY, "id-arthur")).toEqual({ ok: false, reason: "no-default-workspace" });
	});
});

describe("workspace-access — workspacesFor", () => {
	it("lists an identity's selectable workspaces (for a picker)", () => {
		expect(workspacesFor(POLICY, "id-arthur").map((w) => w.id)).toEqual([
			"personal-arthur",
			"collective-casa",
		]);
		expect(workspacesFor(POLICY, "id-stranger")).toEqual([]);
	});
});

describe("workspace-access — validatePolicy", () => {
	it("passes a well-formed policy", () => {
		expect(validatePolicy(POLICY)).toEqual([]);
	});

	it("rejects an unsafe namespace (a DB-path injection)", () => {
		const bad: AccessPolicy = {
			workspaces: [{ id: "w", kind: "personal", namespace: "../../evil" }],
			memberships: [],
		};
		expect(validatePolicy(bad)).toContain('unsafe namespace for w: "../../evil"');
	});

	it("flags a membership referencing a workspace that doesn't exist", () => {
		const bad: AccessPolicy = {
			workspaces: [{ id: "w", kind: "personal", namespace: "w" }],
			memberships: [{ identity: "id", workspaces: ["ghost"] }],
		};
		expect(validatePolicy(bad)).toContain("membership id references unknown workspace: ghost");
	});
});
