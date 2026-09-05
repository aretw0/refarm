import { resolveWorkspaceLedger, type LedgerResolution } from "@refarm.dev/cli";
import { describe, expect, it, vi } from "vitest";

import {
	buildIssuesList,
	buildIssuesValidate,
	createIssuesCommand,
	type IssuesIo,
} from "../../src/commands/issues.js";

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

	// Finding 2 — a declared provider nobody implemented must refuse distinctly, naming the
	// declared provider AND the providers that ARE implemented, rather than falling through to
	// `providerFrom: "convention"` and silently discarding the operator's explicit declaration.
	it("refuses a declared-but-unsupported provider with provider_unsupported, never falling through to convention", () => {
		const catalog = [
			{
				id: "future-gh",
				absolutePath: "/ws/future-gh",
				issues: { provider: "github", path: ".project/issues.json", unsupported: true as const },
			},
		];
		const result = resolveWorkspaceLedger({
			workspace: "future-gh",
			cwd: "/tmp",
			loadWorkspaces: () => catalog,
			// Even though a `.project/issues.json` DOES exist by convention, the declared-but-
			// unsupported provider must win — the convention path must never be reached.
			fileExists: () => true,
			readDocument: () => JSON.stringify({ issues: [] }),
			writeDocument: () => {},
		});
		expect(result).toMatchObject({
			ok: false,
			reason: "provider_unsupported",
			declaredProvider: "github",
			implementedProviders: ["project-json"],
			declared: ["future-gh"],
		});
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
		// FINDING 7: the message travels alongside the reason — this bucket used to drop it.
		expect(outcome.unreadable.bad).toEqual({
			reason: "document_unreadable",
			message: expect.any(String),
		});
		expect(outcome.unreadable.bad?.message.length).toBeGreaterThan(0);
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

	// ─────────────────────────────────────────────────────────────────────────────────────────
	// FINDING 1 (THE EIGHTH INSTANCE) — `--axis`/`--status` used to be unvalidated filter
	// predicates: a typo silently matched nothing, and `count: 0, ok: true` was indistinguishable
	// from a workspace with genuinely nothing left on that axis. `add`/`set-status`/`set-axis` all
	// validate this exact vocabulary; `list` must too, and refuse BEFORE resolving any workspace.
	// ─────────────────────────────────────────────────────────────────────────────────────────

	it("refuses an unknown --axis, naming the bad value AND the legal ones, before resolving any workspace", () => {
		const outcome = buildIssuesList({
			workspace: "good",
			axis: "costs", // typo for "cost" — proven live in the review
			cwd: "/tmp",
			...fakeIo(),
		});
		expect(outcome.kind).toBe("invalid_input");
		if (outcome.kind !== "invalid_input") throw new Error("expected invalid_input");
		expect(outcome.reason).toBe("invalid_axis");
		expect(outcome.message).toContain("costs");
		expect(outcome.message).toContain("node-vs-directory");
		expect(outcome.message).toContain("cost");
		expect(outcome.message).toContain("other");
	});

	it("refuses an unknown --status, naming the bad value AND the legal ones, before resolving any workspace", () => {
		const outcome = buildIssuesList({
			workspace: "good",
			status: "opne", // typo for "open" — proven live in the review
			cwd: "/tmp",
			...fakeIo(),
		});
		expect(outcome.kind).toBe("invalid_input");
		if (outcome.kind !== "invalid_input") throw new Error("expected invalid_input");
		expect(outcome.reason).toBe("invalid_status");
		expect(outcome.message).toContain("opne");
		expect(outcome.message).toContain("open");
		expect(outcome.message).toContain("deferred");
		expect(outcome.message).toContain("resolved");
	});

	it("accepts every declared axis and status without refusing", () => {
		for (const axis of ["node-vs-directory", "cost", "sandbox", "durability", "other"]) {
			const outcome = buildIssuesList({ workspace: "good", axis, cwd: "/tmp", ...fakeIo() });
			expect(outcome.kind).toBe("ok");
		}
		for (const status of ["open", "deferred", "resolved"]) {
			const outcome = buildIssuesList({ workspace: "good", status, cwd: "/tmp", ...fakeIo() });
			expect(outcome.kind).toBe("ok");
		}
	});

	// FINDING 4 — `--workspace` was silently ignored when `--all-workspaces` was also passed.
	it("refuses --workspace combined with --all-workspaces rather than silently picking one", () => {
		const outcome = buildIssuesList({
			workspace: "good",
			allWorkspaces: true,
			cwd: "/tmp",
			...fakeIo(),
		});
		expect(outcome.kind).toBe("invalid_input");
		if (outcome.kind !== "invalid_input") throw new Error("expected invalid_input");
		expect(outcome.reason).toBe("conflicting_scope");
		expect(outcome.message).toContain("--workspace");
		expect(outcome.message).toContain("--all-workspaces");
	});
});

interface IssuesEnvelope {
	ok: boolean;
	error?: string;
	message?: string;
	nextCommand?: string | null;
	nextCommands?: string[];
	workspaces?: Record<string, unknown>;
	unreadable?: Record<string, unknown>;
	item?: { id: string; axis?: string; status?: string };
	valid?: boolean;
	counts?: { total: number; open: number; deferred: number; resolved: number };
	findings?: Array<{ reason: string; ids: string[] }>;
	extraFields?: string[];
}

async function runIssues(
	argv: string[],
	io: IssuesIo,
): Promise<{ envelope: IssuesEnvelope; exitCode: number | string | undefined }> {
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	const previousExitCode = process.exitCode;
	process.exitCode = undefined;
	await createIssuesCommand(io).parseAsync(argv, { from: "user" });
	const envelope = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as IssuesEnvelope;
	const exitCode = process.exitCode;
	process.exitCode = previousExitCode;
	logSpy.mockRestore();
	return { envelope, exitCode };
}

async function runIssuesList(
	args: string[],
	io: IssuesIo,
): Promise<{ envelope: IssuesEnvelope; exitCode: number | string | undefined }> {
	return runIssues(["list", ...args], io);
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

	// FINDING 1 (THE EIGHTH INSTANCE) — proven live in the review: `refarm issues list --workspace
	// refarm --axis costs --json` returned `ok: true, count: 0`, exit 0. Same for `--status opne`.
	it("refuses an unknown --axis with a non-zero exit, naming the bad value and the legal ones", async () => {
		const { envelope, exitCode } = await runIssuesList(
			["--workspace", "good", "--axis", "costs", "--json"],
			fakeIo(),
		);
		expect(envelope.ok).toBe(false);
		expect(envelope.error).toBe("invalid_axis");
		expect(envelope.message).toContain("costs");
		expect(envelope.message).toContain("cost");
		expect(exitCode).toBe(1);
	});

	it("refuses an unknown --status with a non-zero exit, naming the bad value and the legal ones", async () => {
		const { envelope, exitCode } = await runIssuesList(
			["--workspace", "good", "--status", "opne", "--json"],
			fakeIo(),
		);
		expect(envelope.ok).toBe(false);
		expect(envelope.error).toBe("invalid_status");
		expect(envelope.message).toContain("opne");
		expect(envelope.message).toContain("open");
		expect(exitCode).toBe(1);
	});

	// FINDING 4 — `--workspace` was silently ignored when `--all-workspaces` was also passed.
	it("refuses --workspace combined with --all-workspaces with a non-zero exit", async () => {
		const { envelope, exitCode } = await runIssuesList(
			["--workspace", "good", "--all-workspaces", "--json"],
			fakeIo(),
		);
		expect(envelope.ok).toBe(false);
		expect(envelope.error).toBe("conflicting_scope");
		expect(exitCode).toBe(1);
	});
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// `set-axis` — the writer that did NOT exist when the ledger was migrated, which is why two
// legacy items had to be classified by editing the document by hand. A governed document whose
// only editor is a text editor is the shape that left `tasks.json` and `issues.json` dead from
// 2026-05-05; this closes it for `axis`.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** A ledger with an extra field the contract does not model (rcdc5's shape), one resolved item
 *  with its proof, and every open item classified — the CLEAN case validate must pass. */
const CLEAN_LEDGER = JSON.stringify({
	issues: [
		{
			id: "c1",
			title: "classified",
			body: "b",
			location: "l",
			status: "open",
			priority: "p",
			category: "c",
			package: "pkg",
			axis: "cost",
			description: "a field refarm's schema forbids and rcdc5's carries",
		},
		{
			id: "c2",
			title: "resolved with proof",
			body: "b",
			location: "l",
			status: "resolved",
			priority: "p",
			category: "c",
			package: "pkg",
			resolved_by: "deadbee",
		},
	],
});

/** Captures what the command actually WROTE, so a refusal can be proven to have written nothing
 *  rather than merely to have printed an error. */
function capturingIo(document: string): { io: IssuesIo; writes: string[] } {
	const writes: string[] = [];
	let current = document;
	return {
		writes,
		io: {
			loadWorkspaces: () => [
				{ id: "good", absolutePath: "/ws/good", issues: { provider: "project-json", path: ".project/issues.json" } },
			],
			fileExists: () => true,
			readDocument: () => current,
			writeDocument: (_candidate: string, contents: string) => {
				writes.push(contents);
				current = contents;
			},
		},
	};
}

describe("refarm issues set-axis", () => {
	it("classifies an item that already exists and writes it through the adapter", async () => {
		const { io, writes } = capturingIo(GOOD_LEDGER);
		const { envelope, exitCode } = await runIssues(
			["set-axis", "--workspace", "good", "--id", "a2", "--axis", "durability", "--json"],
			io,
		);
		expect(envelope.ok).toBe(true);
		expect(envelope.item).toMatchObject({ id: "a2", axis: "durability" });
		expect(exitCode).toBeUndefined();
		const written = JSON.parse(String(writes.at(-1))) as { issues: Array<{ id: string; axis?: string }> };
		expect(written.issues.find((issue) => issue.id === "a2")?.axis).toBe("durability");
		// The OTHER item is untouched — a reclassification is not a rewrite of the document.
		expect(written.issues.find((issue) => issue.id === "a1")?.axis).toBe("cost");
	});

	it("refuses an axis outside the declared set and writes NOTHING", async () => {
		const { io, writes } = capturingIo(GOOD_LEDGER);
		const { envelope, exitCode } = await runIssues(
			["set-axis", "--workspace", "good", "--id", "a2", "--axis", "invented", "--json"],
			io,
		);
		expect(envelope.ok).toBe(false);
		expect(envelope.error).toBe("invalid_axis");
		expect(exitCode).toBe(1);
		expect(writes).toEqual([]);
	});

	it("refuses a missing --id before touching the document", async () => {
		const { io, writes } = capturingIo(GOOD_LEDGER);
		const { envelope } = await runIssues(["set-axis", "--workspace", "good", "--axis", "cost", "--json"], io);
		expect(envelope.ok).toBe(false);
		expect(envelope.error).toBe("missing_id");
		expect(writes).toEqual([]);
	});

	it("refuses an unknown id with the adapter's reason, not a silent no-op", async () => {
		const { io, writes } = capturingIo(GOOD_LEDGER);
		const { envelope, exitCode } = await runIssues(
			["set-axis", "--workspace", "good", "--id", "nope", "--axis", "cost", "--json"],
			io,
		);
		expect(envelope.ok).toBe(false);
		expect(envelope.error).toBe("unknown_id");
		expect(exitCode).toBe(1);
		expect(writes).toEqual([]);
	});

	it("keeps a field the contract does not model when reclassifying", async () => {
		const { io, writes } = capturingIo(CLEAN_LEDGER);
		await runIssues(["set-axis", "--workspace", "good", "--id", "c1", "--axis", "sandbox", "--json"], io);
		const written = JSON.parse(String(writes.at(-1))) as {
			issues: Array<{ id: string; axis?: string; description?: string }>;
		};
		const item = written.issues.find((issue) => issue.id === "c1");
		expect(item?.axis).toBe("sandbox");
		expect(item?.description).toBe("a field refarm's schema forbids and rcdc5's carries");
	});
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// `validate` — the fourth contract operation. Three states, never two: a refusal, an unreadable
// document (NEVER a clean empty pass), and a verdict.
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe("buildIssuesValidate", () => {
	it("names every open item that carries no axis", () => {
		const outcome = buildIssuesValidate({ workspace: "good", cwd: "/tmp", ...fakeIo() });
		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") throw new Error("expected ok");
		expect(outcome.valid).toBe(false);
		expect(outcome.findings.map((finding) => finding.reason)).toEqual(["open_without_axis"]);
		expect(outcome.findings[0]?.ids).toEqual(["a2"]);
		expect(outcome.counts).toEqual({ total: 2, open: 2, deferred: 0, resolved: 0 });
	});

	it("names a resolved item with no proof, and a duplicate id", () => {
		const document = JSON.stringify({
			issues: [
				{ id: "d1", title: "t", body: "b", location: "l", status: "resolved", priority: "p", category: "c", package: "k" },
				{ id: "d1", title: "t", body: "b", location: "l", status: "open", priority: "p", category: "c", package: "k", axis: "cost" },
			],
		});
		const outcome = buildIssuesValidate({
			workspace: "good",
			cwd: "/tmp",
			...fakeIo({ readDocument: () => document }),
		});
		if (outcome.kind !== "ok") throw new Error("expected ok");
		expect(outcome.valid).toBe(false);
		expect(outcome.findings.map((finding) => finding.reason).sort()).toEqual([
			"duplicate_id",
			"resolved_without_resolved_by",
		]);
	});

	it("passes a clean ledger and reports its extra fields as INFORMATION, never a finding", () => {
		const outcome = buildIssuesValidate({
			workspace: "good",
			cwd: "/tmp",
			...fakeIo({ readDocument: () => CLEAN_LEDGER }),
		});
		if (outcome.kind !== "ok") throw new Error("expected ok");
		expect(outcome.valid).toBe(true);
		expect(outcome.findings).toEqual([]);
		// rcdc5's `description` is legitimate; a contract that failed on it would be wrong about one
		// of the two real workspaces declared on this node.
		expect(outcome.extraFields).toEqual(["description"]);
		expect(outcome.coercedValues).toEqual([]);
		expect(outcome.counts).toEqual({ total: 2, open: 1, deferred: 0, resolved: 1 });
	});

	it("FAILS a ledger whose status is a word it does not have, naming both values", () => {
		// The gate hole this closes, found by falling into it on 2026-08-11: two finished items were
		// written as "closed". The reader substituted "open" — availability fails open, correctly —
		// and NOTHING said so, so `validate` passed and both sat in the operator's open queue.
		//
		// An unknown FIELD is information (`extraFields`, above): dropping it loses nothing anyone
		// was using. An unknown VALUE is replaced, and the replacement is then indistinguishable
		// from what the author wrote. That asymmetry is why one is a finding and the other is not.
		const outcome = buildIssuesValidate({
			workspace: "good",
			cwd: "/tmp",
			...fakeIo({
				readDocument: () =>
					JSON.stringify({
						issues: [{ id: "a1", title: "t", status: "closed", axis: "cost" }],
					}),
			}),
		});
		if (outcome.kind !== "ok") throw new Error("expected ok");
		expect(outcome.valid).toBe(false);
		expect(outcome.findings.map((finding) => finding.reason)).toContain("unrecognised_value");
		expect(outcome.coercedValues).toEqual([
			{ id: "a1", field: "status", raw: "closed", readAs: "open" },
		]);
		// The message must carry BOTH values. "Invalid status" alone leaves the reader unable to
		// tell what the rest of the system has been seeing in the meantime.
		const message = outcome.findings.find((f) => f.reason === "unrecognised_value")?.message ?? "";
		expect(message).toContain('"closed"');
		expect(message).toContain("read as open");
		expect(message).toContain("open, deferred, resolved");
	});

	it("reports an unreadable document as a read failure, never as a clean empty ledger", () => {
		const outcome = buildIssuesValidate({ workspace: "bad", cwd: "/tmp", ...fakeIo() });
		expect(outcome.kind).toBe("read-failure");
		if (outcome.kind !== "read-failure") throw new Error("expected read-failure");
		expect(outcome.reason).toBe("document_unreadable");
	});

	it("refuses an unresolvable workspace rather than reading ./.project", () => {
		const outcome = buildIssuesValidate({ cwd: "/tmp", ...fakeIo() });
		expect(outcome.kind).toBe("refusal");
	});
});

describe("refarm issues validate — command wiring", () => {
	it("a ledger that breaks a gate rule exits non-zero and hands back a RUNNABLE remediation", async () => {
		const { envelope, exitCode } = await runIssues(["validate", "--workspace", "good", "--json"], fakeIo());
		expect(envelope.ok).toBe(false);
		expect(envelope.error).toBe("invalid_ledger");
		expect(envelope.valid).toBe(false);
		expect(envelope.findings?.[0]?.reason).toBe("open_without_axis");
		expect(envelope.nextCommand).toContain("issues set-axis");
		expect(envelope.nextCommand).toContain("--id a2");
		expect(exitCode).toBe(1);
	});

	it("a clean ledger succeeds with counts and extra fields, exit unset", async () => {
		const { envelope, exitCode } = await runIssues(
			["validate", "--workspace", "good", "--json"],
			fakeIo({ readDocument: () => CLEAN_LEDGER }),
		);
		expect(envelope.ok).toBe(true);
		expect(envelope.valid).toBe(true);
		expect(envelope.counts).toEqual({ total: 2, open: 1, deferred: 0, resolved: 1 });
		expect(envelope.extraFields).toEqual(["description"]);
		expect(envelope.nextCommands).toEqual([]);
		expect(exitCode).toBeUndefined();
	});

	it("an unreadable ledger refuses with document_unreadable rather than reporting it valid", async () => {
		const { envelope, exitCode } = await runIssues(["validate", "--workspace", "bad", "--json"], fakeIo());
		expect(envelope.ok).toBe(false);
		expect(envelope.error).toBe("document_unreadable");
		expect(exitCode).toBe(1);
	});
});
