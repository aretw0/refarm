import { describe, expect, it } from "vitest";
import { buildLedgerSummary } from "../../src/commands/resume.js";

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
