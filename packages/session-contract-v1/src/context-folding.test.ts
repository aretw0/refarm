import { describe, expect, it } from "vitest";
import {
	digestSessionEntryContent,
	planSessionContextFold,
	unfoldSessionContextFold,
} from "./context-folding.js";
import type { SessionEntry, SessionEntryKind } from "./types.js";

function entry(
	id: string,
	index: number,
	kind: SessionEntryKind = "user",
	content = `entry ${index}`,
): SessionEntry {
	return {
		"@type": "SessionEntry",
		"@id": `urn:entry:${id}`,
		session_id: "urn:session:1",
		parent_entry_id: index === 1 ? null : `urn:entry:${index - 1}`,
		kind,
		content,
		timestamp_ns: index,
	};
}

describe("session context folding", () => {
	it("folds cold entries while preserving a protected working tail", () => {
		const entries = [
			entry("1", 1),
			entry("2", 2, "agent"),
			entry("3", 3),
			entry("4", 4, "agent"),
		];

		const plan = planSessionContextFold(entries, {
			protectedTailCount: 2,
			nowNs: () => 100,
			summary: "first exchange",
		});

		expect(plan).not.toBeNull();
		expect(plan?.fold.range).toEqual({
			from_entry_id: "urn:entry:1",
			to_entry_id: "urn:entry:2",
			entry_count: 2,
		});
		expect(plan?.fold.protected_tail_entry_ids).toEqual([
			"urn:entry:3",
			"urn:entry:4",
		]);
		expect(plan?.fold.summary).toBe("first exchange");
		expect(plan?.folded_entries.map((item) => item["@id"])).toEqual([
			"urn:entry:1",
			"urn:entry:2",
		]);
		expect(plan?.protected_tail_entries.map((item) => item["@id"])).toEqual([
			"urn:entry:3",
			"urn:entry:4",
		]);
	});

	it("does not fold when the whole session fits inside the protected tail", () => {
		const plan = planSessionContextFold([entry("1", 1), entry("2", 2)], {
			protectedTailCount: 2,
		});

		expect(plan).toBeNull();
	});

	it("creates deterministic fold digests independent of input ordering", () => {
		const entries = [entry("3", 3), entry("1", 1), entry("2", 2)];
		const first = planSessionContextFold(entries, {
			protectedTailCount: 1,
			nowNs: () => 100,
		});
		const second = planSessionContextFold([...entries].reverse(), {
			protectedTailCount: 1,
			nowNs: () => 200,
		});

		expect(first?.fold.digest).toEqual(second?.fold.digest);
		expect(first?.fold["@id"]).toBe(second?.fold["@id"]);
		expect(first?.fold.created_at_ns).toBe(100);
		expect(second?.fold.created_at_ns).toBe(200);
	});

	it("unfolds entries in folded reference order and reports gaps", () => {
		const entries = [entry("1", 1), entry("2", 2), entry("3", 3)];
		const plan = planSessionContextFold(entries, {
			protectedTailCount: 1,
			nowNs: () => 100,
		});

		const result = unfoldSessionContextFold(plan!.fold, [entries[1]!, entries[2]!]);

		expect(result.entries.map((item) => item["@id"])).toEqual(["urn:entry:2"]);
		expect(result.missing_entry_ids).toEqual(["urn:entry:1"]);
		expect(result.digest_mismatches).toEqual([]);
	});

	it("reports digest mismatches instead of silently accepting mutated content", () => {
		const entries = [entry("1", 1), entry("2", 2)];
		const plan = planSessionContextFold(entries, {
			protectedTailCount: 0,
			nowNs: () => 100,
		});
		const mutated = {
			...entries[0]!,
			content: "mutated",
		};

		const result = unfoldSessionContextFold(plan!.fold, [mutated, entries[1]!]);

		expect(result.digest_mismatches).toHaveLength(1);
		expect(result.digest_mismatches[0]?.entry_id).toBe("urn:entry:1");
		expect(result.digest_mismatches[0]?.actual).toEqual(
			digestSessionEntryContent(mutated),
		);
	});

	it("rejects entries from mixed sessions", () => {
		const mixed = [
			entry("1", 1),
			{ ...entry("2", 2), session_id: "urn:session:2" },
		];

		expect(() =>
			planSessionContextFold(mixed, { protectedTailCount: 0 }),
		).toThrow(/multiple sessions/);
	});
});
