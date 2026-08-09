import { resolveWorkspaceLedger, type LedgerResolution } from "@refarm.dev/cli";
import { describe, expect, it, vi } from "vitest";

import { buildIssuesList, createIssuesCommand, type IssuesIo } from "../../src/commands/issues.js";

const CATALOG = [
	{ id: "refarm", absolutePath: "/home/op/github/refarm", issues: { provider: "project-json", path: ".project/issues.json" } },
	{ id: "rcdc5", absolutePath: "/home/op/git/rcdc5/rcdc5", issues: null },
];

const deps = {
	loadWorkspaces: () => CATALOG,
	fileExists: (p: string) => p === "/home/op/git/rcdc5/rcdc5/.project/issues.json",
	readDocument: () => JSON.stringify({ issues: [] }),
	writeDocument: () => {},
};

/** Strips the `adapter` field — a freshly-minted closure on every successful resolution, never
 *  reference-equal across two calls by design (`resolveWorkspaceLedger` constructs a fresh
 *  `WorkItemAdapter` per call; caching it would let a later call silently keep using an earlier
 *  call's `readDocument`/`writeDocument`, unbounded and never invalidated). Equality assertions
 *  below compare the resolution's actual identifying DATA, never a function reference. */
function serializable(result: LedgerResolution): unknown {
	if (!result.ok) return result;
	const { adapter, ...rest } = result;
	return rest;
}

describe("resolveWorkspaceLedger", () => {
	it("resolves from the flag and says so", () => {
		const result = resolveWorkspaceLedger({ workspace: "refarm", cwd: "/tmp", ...deps });
		expect(result).toMatchObject({
			ok: true,
			workspaceId: "refarm",
			workspaceFrom: "flag",
			providerFrom: "declared",
		});
	});

	it("gives the same answer from any directory", () => {
		const a = resolveWorkspaceLedger({ workspace: "refarm", cwd: "/tmp", ...deps });
		const b = resolveWorkspaceLedger({ workspace: "refarm", cwd: "/home/op/git/rcdc5/rcdc5", ...deps });
		expect(serializable(a)).toEqual(serializable(b));
	});

	it("the flag path and the cwd-match path agree on workspace identity from a third directory", () => {
		const byFlag = resolveWorkspaceLedger({ workspace: "refarm", cwd: "/tmp", ...deps });
		const byCwdMatch = resolveWorkspaceLedger({ cwd: "/home/op/github/refarm/docs/nested", ...deps });
		expect(byFlag.ok).toBe(true);
		expect(byCwdMatch.ok).toBe(true);
		if (byFlag.ok && byCwdMatch.ok) {
			expect(byCwdMatch.workspaceId).toBe(byFlag.workspaceId);
			expect(byCwdMatch.provider).toBe(byFlag.provider);
			expect(byCwdMatch.documentPath).toBe(byFlag.documentPath);
			// The one thing that is SUPPOSED to differ: how each one got there.
			expect(byFlag.workspaceFrom).toBe("flag");
			expect(byCwdMatch.workspaceFrom).toBe("cwd-match");
		}
	});

	it("matches cwd against the catalog and declares the inference", () => {
		const result = resolveWorkspaceLedger({ cwd: "/home/op/github/refarm/docs", ...deps });
		expect(result).toMatchObject({ ok: true, workspaceId: "refarm", workspaceFrom: "cwd-match" });
	});

	it("infers project-json by convention when undeclared but present, and says so", () => {
		const result = resolveWorkspaceLedger({ workspace: "rcdc5", cwd: "/tmp", ...deps });
		expect(result).toMatchObject({ ok: true, provider: "project-json", providerFrom: "convention" });
	});

	it("reports workspaceFrom: \"enumerated\" when resolving on behalf of a batch enumeration", () => {
		// The --all-workspaces path: the CALLER looked up this id itself, not an operator flag.
		const result = resolveWorkspaceLedger({ workspace: "refarm", cwd: "/tmp", enumerated: true, ...deps });
		expect(result).toMatchObject({ ok: true, workspaceId: "refarm", workspaceFrom: "enumerated" });
	});

	it("refuses an unmatched cwd and lists the declared workspaces — never reads ./.project", () => {
		const result = resolveWorkspaceLedger({ cwd: "/tmp", ...deps });
		expect(result).toMatchObject({ ok: false, reason: "cwd_unmatched", declared: ["refarm", "rcdc5"] });
	});

	it("refuses an unknown workspace id", () => {
		const result = resolveWorkspaceLedger({ workspace: "nope", cwd: "/tmp", ...deps });
		expect(result).toMatchObject({ ok: false, reason: "no_such_workspace" });
	});

	it("reports no provider when neither declaration nor convention applies", () => {
		const result = resolveWorkspaceLedger({
			workspace: "rcdc5",
			cwd: "/tmp",
			...deps,
			fileExists: () => false,
		});
		expect(result).toMatchObject({ ok: false, reason: "no_provider" });
	});
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// `refarm issues list` — the command's own logic, with FAKE IO. Nothing here reads a real
// `~/.refarm/config.json` or a real `.project/issues.json`.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const GOOD_LEDGER = JSON.stringify({
	issues: [
		{
			id: "a1",
			title: "classified",
			body: "b",
			location: "l",
			status: "open",
			priority: "p1",
			category: "c",
			package: "pkg",
			axis: "cost",
		},
		{
			id: "a2",
			title: "unclassified",
			body: "b2",
			location: "l2",
			status: "open",
			priority: "p2",
			category: "c2",
			package: "pkg2",
			// no axis — must be counted, never folded into an axis bucket
		},
	],
});

function fakeIo(overrides: Partial<IssuesIo> = {}): IssuesIo {
	return {
		loadWorkspaces: () => [
			{ id: "good", absolutePath: "/ws/good", issues: { provider: "project-json", path: ".project/issues.json" } },
			{ id: "bad", absolutePath: "/ws/bad", issues: { provider: "project-json", path: ".project/issues.json" } },
		],
		fileExists: () => true,
		readDocument: (candidate: string) => (candidate.includes("/ws/bad/") ? "{not valid json" : GOOD_LEDGER),
		writeDocument: () => {},
		...overrides,
	};
}

/** `Record<string, T>` indexing is `T | undefined` under `noUncheckedIndexedAccess` — this
 *  asserts presence with a message, rather than sprinkling `!` through the assertions below. */
function requireGroup<T>(groups: Record<string, T>, id: string): T {
	const group = groups[id];
	if (!group) throw new Error(`expected a "${id}" group, got: ${Object.keys(groups).join(", ")}`);
	return group;
}

describe("buildIssuesList", () => {
	it("classifies a single-workspace ledger read failure as a refusal, not an empty ok", () => {
		// CRITICAL: before this fix, `list --workspace bad --json` against a malformed ledger
		// returned `{ kind: "ok", groups: {}, unreadable: {} }` — ok:true, an empty payload, exit
		// 0 — a zero that was never a real zero. Never omitted, never merged into "no items".
		const outcome = buildIssuesList({ workspace: "bad", cwd: "/tmp", ...fakeIo() });
		expect(outcome.kind).toBe("read-failure");
		if (outcome.kind === "read-failure") {
			expect(outcome.workspaceId).toBe("bad");
			expect(outcome.reason).toBe("document_unreadable");
		}
	});

	it("groups --all-workspaces, qualifies ids, never merges into one flat list, and lands a failing adapter in unreadable — never omitted, never zero", () => {
		const outcome = buildIssuesList({ allWorkspaces: true, cwd: "/tmp", ...fakeIo() });
		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") throw new Error("expected ok");
		expect(Object.keys(outcome.groups)).toEqual(["good"]);
		expect(Object.keys(outcome.unreadable)).toEqual(["bad"]);
		expect(outcome.unreadable.bad).toEqual({ reason: "document_unreadable" });
		// Ids are qualified per workspace, and this workspace's items carry only its own ids —
		// nothing merged from any other workspace's namespace.
		expect(requireGroup(outcome.groups, "good").items.map((item) => item.qualifiedId)).toEqual([
			"good#a1",
			"good#a2",
		]);
	});

	it("counts an item with no axis as unclassified, never folded into an axis bucket", () => {
		const outcome = buildIssuesList({ workspace: "good", cwd: "/tmp", ...fakeIo() });
		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") throw new Error("expected ok");
		const good = requireGroup(outcome.groups, "good");
		expect(good.count).toBe(2);
		expect(good.unclassified).toBe(1);
	});

	it('reports workspaceFrom: "enumerated" on the --all-workspaces batch path', () => {
		const outcome = buildIssuesList({ allWorkspaces: true, cwd: "/tmp", ...fakeIo() });
		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") throw new Error("expected ok");
		const good = requireGroup(outcome.groups, "good");
		expect(good.workspaceFrom).toBe("enumerated");
		expect(good.providerFrom).toBe("declared");
	});
});

interface IssuesEnvelope {
	ok: boolean;
	error?: string;
	message?: string;
	nextCommand?: string | null;
	workspaces?: Record<string, unknown>;
	unreadable?: Record<string, unknown>;
}

async function runIssuesList(
	args: string[],
	io: IssuesIo,
): Promise<{ envelope: IssuesEnvelope; exitCode: number | string | undefined }> {
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	const previousExitCode = process.exitCode;
	process.exitCode = undefined;
	await createIssuesCommand(io).parseAsync(["list", ...args], { from: "user" });
	const envelope = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as IssuesEnvelope;
	const exitCode = process.exitCode;
	process.exitCode = previousExitCode;
	logSpy.mockRestore();
	return { envelope, exitCode };
}

describe("refarm issues list — command wiring", () => {
	it("a single-workspace ledger read failure refuses with a non-zero exit and an error envelope", async () => {
		const { envelope, exitCode } = await runIssuesList(["--workspace", "bad", "--json"], fakeIo());
		expect(envelope.ok).toBe(false);
		expect(envelope.error).toBe("document_unreadable");
		expect(typeof envelope.nextCommand).toBe("string");
		expect(exitCode).toBe(1);
	});

	it("--all-workspaces succeeds (exit unset) with the failing workspace named in unreadable", async () => {
		const { envelope, exitCode } = await runIssuesList(["--all-workspaces", "--json"], fakeIo());
		expect(envelope.ok).toBe(true);
		expect(Object.keys(envelope.workspaces ?? {})).toEqual(["good"]);
		expect(Object.keys(envelope.unreadable ?? {})).toEqual(["bad"]);
		expect(exitCode).toBeUndefined();
	});
});
