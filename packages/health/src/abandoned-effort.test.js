import { describe, expect, it } from "vitest";

import { abandonedTasks, classifyStoredTask, describeAbandonedTasks } from "./abandoned-effort.js";

/**
 * MEASURED ON THE OPERATOR'S NODE 2026-08-23:
 *
 *   task 18c857e02f2d2fc70016   status: active   updated_at: 2026-08-03 16:17:52
 *   GET /efforts -> []          GET /tasks -> stored=82
 *
 * Twenty days non-terminal, while `refarm task list` reported total=0 — it reads `/efforts`, which
 * legitimately holds zero, and nothing reads the 82 the graph stores. Nothing resumes it is the
 * smaller half; nothing NAMES it is the larger one.
 *
 * The invariant is OWNERSHIP, not age: the daemon exposes no start time (its routes are
 * `/connections /efforts /nodes /notices /plugins /sessions /tasks`), and it does not need to —
 * a non-terminal task the daemon does not own is abandoned by construction.
 */
const OWNED = ["urn:live:1"];

describe("classifyStoredTask", () => {
	it("calls a terminal task settled, owned or not", () => {
		for (const status of ["done", "delivered", "partial", "failed", "timed-out", "cancelled"]) {
			expect(classifyStoredTask({ id: "x", status }, new Set())).toBe("settled");
		}
	});

	it("calls a non-terminal task the daemon OWNS live", () => {
		expect(classifyStoredTask({ id: "urn:live:1", status: "in-progress" }, new Set(OWNED))).toBe("owned");
	});

	it("calls a non-terminal task nobody owns ABANDONED", () => {
		expect(classifyStoredTask({ id: "urn:gone:1", status: "in-progress" }, new Set(OWNED))).toBe("abandoned");
		expect(classifyStoredTask({ id: "urn:gone:2", status: "pending" }, new Set(OWNED))).toBe("abandoned");
	});

	it("treats the retired word `active` as non-terminal, because the one real stuck record carries it", () => {
		// The sidecar's own note: `active` "read as in-progress but consumers had no such state". A
		// classifier that did not know it would call the single live instance settled.
		expect(classifyStoredTask({ id: "urn:sovereign:task:v1:18c857e02f2d2fc70016", status: "active" }, new Set())).toBe(
			"abandoned",
		);
	});

	it("treats an UNKNOWN status word as non-terminal, which is the safe direction", () => {
		// The vocabulary has already grown a retired member and will grow again. Reading a word it
		// does not know as finished would hide exactly the case this exists to find.
		expect(classifyStoredTask({ id: "urn:new:1", status: "quiesced" }, new Set())).toBe("abandoned");
	});
});

describe("describeAbandonedTasks", () => {
	it("says nothing when every stored task is settled or owned", () => {
		expect(
			describeAbandonedTasks(
				[
					{ id: "a", status: "done" },
					{ id: "urn:live:1", status: "in-progress" },
				],
				OWNED,
			),
		).toBeNull();
	});

	it("names how many and the first, because a count alone is not actionable", () => {
		const text = describeAbandonedTasks(
			[
				{ id: "urn:sovereign:task:v1:18c857e02f2d2fc70016", status: "active" },
				{ id: "urn:gone:2", status: "pending" },
				{ id: "urn:ok", status: "done" },
			],
			[],
		);
		expect(text).toContain("2");
		expect(text).toContain("18c857e02f2d2fc70016");
	});

	it("says NOTHING when the daemon could not be asked what it owns", () => {
		// Without the live set there is no invariant, and reporting every non-terminal task as
		// abandoned would condemn the ones actually running. Not "probably abandoned".
		expect(describeAbandonedTasks([{ id: "a", status: "in-progress" }], null)).toBeNull();
	});

	it("names no CLI verb, so any surface can render it", () => {
		expect(describeAbandonedTasks([{ id: "urn:x", status: "active" }], [])).not.toMatch(/refarm |git /u);
	});

	it("abandonedTasks returns the records themselves, so a surface can render more than a sentence", () => {
		expect(abandonedTasks([{ id: "urn:x", status: "active" }, { id: "urn:y", status: "done" }], [])).toEqual([
			{ id: "urn:x", status: "active" },
		]);
	});
});
