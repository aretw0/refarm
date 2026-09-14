import { describe, expect, it } from "vitest";

import { auditPageCoherence, runQueryNodesPageConformance } from "./page-conformance.js";
import { type QueryNodesPage, type StorageAdapter, readCompleteness } from "./types.js";

/** The smallest adapter that satisfies the interface, plus whatever page it is told to return.
 *  `page` is supplied rather than derived, which is the whole point — this fixture must be ABLE
 *  to lie, or it cannot prove the conformance catches lying. */
function adapterReturning(page: QueryNodesPage | null, seeded: string[] = []): StorageAdapter {
	const rows: unknown[] = [...seeded];
	return {
		ensureSchema: async () => {},
		storeNode: async (id) => {
			rows.push(id);
		},
		queryNodes: async () => rows,
		...(page === null ? {} : { queryNodesPage: async () => page }),
		execute: async () => undefined,
		query: async () => [],
		close: async () => {},
	} as unknown as StorageAdapter;
}

describe("readCompleteness", () => {
	it("reads absent truncation as unknown, never as complete", () => {
		expect(readCompleteness({ nodes: [] })).toBe("unknown");
		expect(readCompleteness({ nodes: [], stored: 0 })).toBe("unknown");
	});

	it("separates the two states an empty list can be in", () => {
		// The distinction the entire family turns on: both pages carry zero rows.
		expect(readCompleteness({ nodes: [], truncated: false })).toBe("complete"); // there are none
		expect(readCompleteness({ nodes: [] })).toBe("unknown"); // nobody could tell
	});

	it("reads a cut read as partial", () => {
		expect(readCompleteness({ nodes: [1], stored: 9, truncated: true })).toBe("partial");
	});
});

describe("auditPageCoherence", () => {
	it("accepts partial knowledge — an absent field is not a defect", () => {
		expect(auditPageCoherence({ nodes: [1, 2] })).toEqual([]);
		expect(auditPageCoherence({ nodes: [1, 2], stored: 7 })).toEqual([]);
		expect(auditPageCoherence({ nodes: [1, 2], truncated: true })).toEqual([]);
	});

	it("accepts a coherent complete page and a coherent partial one", () => {
		expect(auditPageCoherence({ nodes: [1, 2], stored: 2, truncated: false })).toEqual([]);
		expect(auditPageCoherence({ nodes: [1, 2], stored: 9, truncated: true })).toEqual([]);
	});

	it("catches THE lie: truncated:false beside a stored that exceeds the rows", () => {
		const findings = auditPageCoherence({ nodes: [1, 2], stored: 9, truncated: false });
		expect(findings).toHaveLength(1);
		expect(findings[0]).toContain("the one lie the type cannot prevent");
		// And the reason it matters: the judgement function believes it.
		expect(readCompleteness({ nodes: [1, 2], stored: 9, truncated: false })).toBe("complete");
	});

	it("catches the milder contradiction too", () => {
		expect(auditPageCoherence({ nodes: [1, 2], stored: 2, truncated: true })[0]).toContain(
			"contradicting itself",
		);
	});

	it("catches a stored below the rows it delivered", () => {
		expect(auditPageCoherence({ nodes: [1, 2, 3], stored: 1 })[0]).toContain(
			"can never be the smaller number",
		);
	});
});

describe("runQueryNodesPageConformance", () => {
	it("reports unsupported — NOT pass — for an adapter without the method", async () => {
		const result = await runQueryNodesPageConformance(adapterReturning(null));
		expect(result.verdict).toBe("unsupported");
		expect(result.verdict).not.toBe("pass");
	});

	it("passes an adapter that reports the truth about a cut read", async () => {
		const result = await runQueryNodesPageConformance(
			adapterReturning({ nodes: [1, 2], stored: 5, truncated: true }),
			{ seed: 5, limit: 2 },
		);
		expect(result).toMatchObject({ verdict: "pass", failures: [] });
		expect(result.observed).toMatchObject({ requested: 2, delivered: 2, stored: 5 });
	});

	it("passes an adapter that admits it cannot tell", async () => {
		const result = await runQueryNodesPageConformance(adapterReturning({ nodes: [1, 2] }), {
			seed: 5,
			limit: 2,
		});
		expect(result.verdict).toBe("pass");
	});

	it("FAILS the case the spec names, against a store known to hold more", async () => {
		const result = await runQueryNodesPageConformance(
			adapterReturning({ nodes: [1, 2], stored: 5, truncated: false }),
			{ seed: 5, limit: 2 },
		);
		expect(result.verdict).toBe("fail");
		expect(result.failures.join(" ")).toContain("the one lie the type cannot prevent");
	});

	it("fails an adapter whose count forgot the rows this run seeded", async () => {
		const result = await runQueryNodesPageConformance(
			adapterReturning({ nodes: [1, 2], stored: 2, truncated: true }),
			{ seed: 5, limit: 2 },
		);
		expect(result.failures.join(" ")).toContain("below the 5 rows this run seeded");
	});

	it("fails an adapter that ignored the limit", async () => {
		const result = await runQueryNodesPageConformance(
			adapterReturning({ nodes: [1, 2, 3, 4, 5], stored: 5, truncated: false }),
			{ seed: 5, limit: 2 },
		);
		expect(result.failures.join(" ")).toContain("limit 2 was ignored");
	});
});
