/**
 * ISS-092. `refarm resume --json` returned `ok: true` with the `project` key ABSENT from outside a
 * project — no tasks, no blockers, no next actions, and `truncation: null`, which is the field the
 * 2026-08-08 slice added so a partial read could not masquerade as a complete one. The entry point
 * CLAUDE.md mandates at every slice start could not distinguish "this node has no pending work" from
 * "I did not read any project".
 *
 * The fix is not "stop reading the directory" — reading the directory was right, and `resume` already
 * returned rcdc5's handoff from inside rcdc5. The fix is that the SAME envelope already resolved its
 * `ledger` block through the node's declared catalog and worked from anywhere, so `resume` carried
 * two resolution models and only one of them could say what it had done. These tests pin the second
 * one down to four states that never collapse.
 */
import { describe, expect, it } from "vitest";

import { resolveProjectHandoff } from "../../src/commands/resume.js";

const CATALOG = [
	{ id: "refarm", absolutePath: "/home/op/github/refarm", issues: null },
	{ id: "rcdc5", absolutePath: "/home/op/git/rcdc5/rcdc5", issues: null },
];

const HANDOFF = JSON.stringify({
	context: "a real checkpoint",
	timestamp: "2026-08-10T00:00:00.000Z",
	current_phase: 14,
	current_tasks: ["one", "two"],
	blockers: [],
	next_actions: ["next"],
	open_questions: [],
});

function io(overrides: Partial<Parameters<typeof resolveProjectHandoff>[0]> = {}) {
	return {
		loadWorkspaces: () => CATALOG,
		fileExists: (candidate: string) =>
			candidate === "/home/op/github/refarm/.project/handoff.json" ||
			candidate === "/home/op/git/rcdc5/rcdc5/.project/handoff.json",
		readDocument: () => HANDOFF,
		...overrides,
	};
}

describe("resolveProjectHandoff", () => {
	it("answers about a workspace the caller is not standing in, when asked by id", () => {
		// The whole point of the operator's decision: from a phone, from Termux, from /tmp, he can
		// ask about refarm without being inside its checkout.
		const result = resolveProjectHandoff({ workspace: "refarm", cwd: "/tmp", ...io() });
		expect(result.resolution).toEqual({
			state: "read",
			workspaceId: "refarm",
			from: "flag",
			path: "/home/op/github/refarm/.project/handoff.json",
		});
		expect(result.summary?.currentPhase).toBe(14);
	});

	it("matches the cwd against the declared catalog and says which workspace answered", () => {
		const result = resolveProjectHandoff({ cwd: "/home/op/git/rcdc5/rcdc5/packages/x", ...io() });
		expect(result.resolution).toMatchObject({ state: "read", workspaceId: "rcdc5", from: "cwd-match" });
	});

	it("prefers the LONGEST match, so a nested workspace is not shadowed by its parent", () => {
		const nested = [
			{ id: "outer", absolutePath: "/home/op/git", issues: null },
			{ id: "inner", absolutePath: "/home/op/git/rcdc5/rcdc5", issues: null },
		];
		const result = resolveProjectHandoff({
			cwd: "/home/op/git/rcdc5/rcdc5",
			...io({ loadWorkspaces: () => nested }),
		});
		expect(result.resolution).toMatchObject({ workspaceId: "inner" });
	});

	it("still reads an undeclared project by convention, and reports that it inferred", () => {
		// Nothing that works today may stop working: a checkout nobody declared still answers, and
		// the envelope says the answer came from the directory rather than from the catalog.
		const result = resolveProjectHandoff({
			cwd: "/home/op/scratch/thing",
			...io({ fileExists: (c: string) => c === "/home/op/scratch/thing/.project/handoff.json" }),
		});
		expect(result.resolution).toEqual({
			state: "read",
			workspaceId: null,
			from: "cwd-convention",
			path: "/home/op/scratch/thing/.project/handoff.json",
		});
	});

	it("THE DEFECT: absence is explicit, names where it looked, and lists the declared workspaces", () => {
		const result = resolveProjectHandoff({ cwd: "/tmp", ...io({ fileExists: () => false }) });
		expect(result.summary).toBeUndefined();
		expect(result.resolution).toEqual({
			state: "absent",
			reason: "no-project-here",
			cwd: "/tmp",
			declared: ["refarm", "rcdc5"],
		});
	});

	it("an unknown --workspace refuses by name instead of falling back to the directory", () => {
		const result = resolveProjectHandoff({ workspace: "nope", cwd: "/home/op/github/refarm", ...io() });
		// NO `cwd` (ISS-111): this branch is reachable only when the operator NAMED a workspace, so
		// the directory played no part in reaching it. Reporting it made an otherwise
		// directory-independent answer vary across machines by a field that means nothing —
		// found by the seeded-node fixture, which reaches this branch a populated node cannot.
		expect(result.resolution).toEqual({
			state: "absent",
			reason: "no-such-workspace",
			declared: ["refarm", "rcdc5"],
		});
		expect(result.resolution).not.toHaveProperty("cwd");
	});

	it("keeps `cwd` when the DIRECTORY is how the answer was reached", () => {
		// The other half of ISS-111, and the reason the field was not simply deleted: under
		// `cwd-match` or `cwd-convention` the directory IS the resolution, and reporting it is the
		// entire point of the `projectResolution` block (ISS-092).
		const result = resolveProjectHandoff({ cwd: "/tmp/nowhere", ...io({ fileExists: () => false }) });
		expect(result.resolution).toMatchObject({
			state: "absent",
			reason: "no-project-here",
			cwd: "/tmp/nowhere",
		});
	});

	it("a declared workspace with no handoff is ABSENT, and says which workspace lacks one", () => {
		const result = resolveProjectHandoff({
			workspace: "rcdc5",
			cwd: "/tmp",
			...io({ fileExists: () => false }),
		});
		expect(result.resolution).toMatchObject({ state: "absent", reason: "no-handoff-in-workspace", workspaceId: "rcdc5" });
	});

	it("an unreadable handoff is UNREADABLE, never an empty project", () => {
		const result = resolveProjectHandoff({
			workspace: "refarm",
			cwd: "/tmp",
			...io({ readDocument: () => "{ not json" }),
		});
		expect(result.summary).toBeUndefined();
		expect(result.resolution).toMatchObject({ state: "unreadable", path: "/home/op/github/refarm/.project/handoff.json" });
		expect((result.resolution as { reason: string }).reason.length).toBeGreaterThan(0);
	});

	it("a handoff with no checkpoint at all is EMPTY, which is not the same as absent", () => {
		// Four states, and these are the two the old `return undefined` collapsed most dangerously:
		// a project that exists and has never been checkpointed, and no project at all.
		const result = resolveProjectHandoff({
			workspace: "refarm",
			cwd: "/tmp",
			...io({ readDocument: () => JSON.stringify({ current_tasks: [] }) }),
		});
		expect(result.summary).toBeUndefined();
		expect(result.resolution).toMatchObject({ state: "empty", workspaceId: "refarm" });
	});

	it("gives the same answer for the same workspace from every directory", () => {
		const fromTmp = resolveProjectHandoff({ workspace: "refarm", cwd: "/tmp", ...io() });
		const fromElsewhere = resolveProjectHandoff({ workspace: "refarm", cwd: "/home/op/git/rcdc5/rcdc5", ...io() });
		expect(fromTmp).toEqual(fromElsewhere);
	});
});

describe("resume never falls over because of the project block", () => {
	it("degrades to the convention path and REPORTS a catalog it could not read", () => {
		// Found by the existing suite rather than by inspection: the first version of this resolver
		// let the catalog loader throw straight through `emitResume`, so a node whose config could
		// not be read would have crashed `refarm resume` entirely. This is the command an operator
		// runs precisely when he does not know what state anything is in — it must always answer.
		const result = resolveProjectHandoff({
			cwd: "/home/op/scratch/thing",
			loadWorkspaces: () => {
				throw new Error("MissingSovereignDirError: no substrate default");
			},
			fileExists: (candidate: string) => candidate === "/home/op/scratch/thing/.project/handoff.json",
			readDocument: () => HANDOFF,
		});
		expect(result.summary?.currentPhase).toBe(14);
		expect(result.resolution).toMatchObject({
			state: "read",
			from: "cwd-convention",
			catalogError: "MissingSovereignDirError: no substrate default",
		});
	});

	it("an unreadable catalog with nothing to fall back on is absent AND names the catalog failure", () => {
		const result = resolveProjectHandoff({
			cwd: "/tmp",
			loadWorkspaces: () => {
				throw new Error("EACCES");
			},
			fileExists: () => false,
			readDocument: () => HANDOFF,
		});
		expect(result.resolution).toMatchObject({
			state: "absent",
			reason: "no-project-here",
			declared: [],
			catalogError: "EACCES",
		});
	});
});
