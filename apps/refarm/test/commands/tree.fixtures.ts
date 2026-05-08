import { expect } from "vitest";

export const SESSION = {
	"@id": "urn:refarm:session:v1:abc123def456",
	"@type": "Session",
	name: "auth-refactor",
	created_at_ns: 1_700_000_000_000_000_000,
	leaf_entry_id: "entry-2",
	parent_session_id: "urn:refarm:session:v1:parent00000001",
};

export const OLDER_SESSION = {
	"@id": "urn:refarm:session:v1:older00000001",
	"@type": "Session",
	name: "older-branch",
	created_at_ns: 1_600_000_000_000_000_000,
	leaf_entry_id: "entry-old",
};

export const HISTORY = {
	session: SESSION,
	entries: [
		{ id: "entry-1", kind: "user", content: "plan", timestamp_ns: 1 },
		{ id: "entry-2", kind: "assistant", content: "done", timestamp_ns: 2 },
	],
	total: 2,
};

export const GIT_LINE = [
	"abcdef1234567890abcdef1234567890abcdef12",
	"1111111111111111111111111111111111111111",
	"HEAD -> develop, origin/develop",
	"2026-05-06T14:00:00+00:00",
	"feat(refarm): grow timeline tree",
].join("");

export const SAME_TIMESTAMP_GIT_LINE = [
	"abcdef1234567890abcdef1234567890abcdef12",
	"1111111111111111111111111111111111111111",
	"HEAD -> develop, origin/develop",
	"2023-11-14T22:13:20.000Z",
	"feat(refarm): grow timeline tree",
].join("");

export function expectPreviewPlanSubstrateFactsNested(
	plan: Record<string, unknown>,
): void {
	expect(plan).toHaveProperty("action");
	expect(plan).toHaveProperty("destructive");
	expect(plan).toHaveProperty("readyToExecute");
	expect(plan).toHaveProperty("recommendedCommand");
	expect(plan).toHaveProperty("effects");
	expect(plan).toHaveProperty("substrate");

	const effects = plan.effects as Record<string, unknown>;
	expect(Object.keys(effects).sort()).toEqual([
		"activePointerChanged",
		"branchCreated",
	]);

	for (const substrateOnlyKey of [
		"kind",
		"branchName",
		"branchPointEntryId",
		"activeSessionIdBefore",
		"targetSessionIdAfter",
		"activeSessionWillSwitch",
		"baseCommit",
		"currentRefBefore",
		"targetRefAfter",
		"targetCommit",
		"worktreeClean",
		"worktreeSwitched",
	]) {
		expect(plan).not.toHaveProperty(substrateOnlyKey);
	}
}
