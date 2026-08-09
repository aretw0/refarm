import type { LedgerWorkspace } from "@refarm.dev/cli";
import { describe, expect, it } from "vitest";
import { buildLedgerSummary, loadLedgerReads, type LedgerIo } from "../../src/commands/resume.js";

/** `Record<string, T>` indexing is `T | undefined` under `noUncheckedIndexedAccess` — this
 *  asserts presence with a message, rather than sprinkling `!` through the assertions below.
 *  Mirrors `requireGroup` in `test/commands/issues.test.ts`. */
function requireEntry<T>(record: Record<string, T>, id: string): T {
	const entry = record[id];
	if (!entry) throw new Error(`expected a "${id}" entry, got: ${Object.keys(record).join(", ")}`);
	return entry;
}

describe("buildLedgerSummary", () => {
	it("groups by workspace and never sums across them", () => {
		const summary = buildLedgerSummary({
			refarm: { ok: true, items: [{ id: "ISS-001", status: "open", axis: "cost" }] },
			rcdc5: { ok: true, items: [{ id: "issue-001", status: "open", axis: undefined }] },
		});
		expect(requireEntry(summary.workspaces, "refarm").open).toBe(1);
		expect(requireEntry(summary.workspaces, "rcdc5").open).toBe(1);
		expect(summary).not.toHaveProperty("total");
	});

	it("reports unclassified as its own row, never folded into an axis", () => {
		const summary = buildLedgerSummary({
			rcdc5: { ok: true, items: [{ id: "a", status: "open" }, { id: "b", status: "open", axis: "cost" }] },
		});
		const rcdc5 = requireEntry(summary.workspaces, "rcdc5");
		expect(rcdc5.unclassified).toBe(1);
		expect(rcdc5.byAxis).toEqual({ cost: 1 });
	});

	it("puts a failed workspace in unreadable, not at zero", () => {
		const summary = buildLedgerSummary({
			broken: { ok: false, error: { reason: "document_unreadable", message: "boom" } },
		});
		expect(summary.workspaces).not.toHaveProperty("broken");
		expect(requireEntry(summary.unreadable, "broken").reason).toBe("document_unreadable");
	});

	it("counts only open items", () => {
		const summary = buildLedgerSummary({
			refarm: { ok: true, items: [{ id: "a", status: "resolved" }, { id: "b", status: "open", axis: "cost" }] },
		});
		expect(requireEntry(summary.workspaces, "refarm").open).toBe(1);
	});
});

describe("loadLedgerReads", () => {
	it("keeps reading every declared workspace after one throws — a per-iteration catch, not a catch around the whole loop", () => {
		// "broken" is FIRST in catalog order on purpose: if a future edit widened the try/catch
		// to wrap the whole `for` loop instead of one per iteration, the throw below would abort
		// the loop right here and "good" would never be reached — this test would then fail on
		// property (3), which is exactly the regression it exists to catch.
		//
		// The throw is forced through `fileExists` (uncaught anywhere between here and
		// `resolveWorkspaceLedger`), not through `readDocument` — a `readDocument` throw is
		// already caught INSIDE the project-json adapter's own `list()` and surfaces as an
		// ordinary `{ ok: false }` read, which exercises a different, already-covered branch of
		// `loadLedgerReads`, not the outer per-workspace catch this test targets.
		const io: LedgerIo = {
			loadWorkspaces: (): LedgerWorkspace[] => [
				{ id: "broken", absolutePath: "/ws/broken", issues: null },
				{
					id: "good",
					absolutePath: "/ws/good",
					issues: { provider: "project-json", path: ".project/issues.json" },
				},
			],
			fileExists: (candidate: string) => {
				if (candidate.includes("/ws/broken/")) throw new Error("disk gremlin");
				return true;
			},
			readDocument: () => JSON.stringify({ issues: [{ id: "a", status: "open", axis: "cost" }] }),
			writeDocument: () => {},
		};

		const summary = buildLedgerSummary(loadLedgerReads(io));

		// (1) the throwing workspace appears in `unreadable` with its reason.
		expect(requireEntry(summary.unreadable, "broken").reason).toBe("ledger_read_failed");
		// (2) the throwing workspace is ABSENT from `workspaces` — never `{ open: 0 }`.
		expect(summary.workspaces).not.toHaveProperty("broken");
		// (3) the SUCCEEDING workspace still appears with its real count — the one property that
		// breaks under the exact widening this test is written to catch.
		expect(requireEntry(summary.workspaces, "good").open).toBe(1);
	});
});
