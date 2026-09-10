import type { QueryNodesPage, StorageAdapter } from "./types.js";

/**
 * THE ONE LIE THE TYPE CANNOT PREVENT.
 *
 * `QueryNodesPage` makes `stored` and `truncated` optional so an adapter that cannot measure them
 * says so by omission. What it cannot stop is an adapter that measures them WRONG — and the
 * dangerous direction is not a missing field, it is `truncated: false` beside a `stored` that
 * exceeds the rows delivered. That reads as *"this is the whole answer"* to every consumer, and
 * `readCompleteness` will faithfully return `"complete"` for it, because the type kept its promise
 * and the adapter broke its own.
 *
 * PURE, so the contradiction is a value a test can assert on rather than a thrown error.
 *
 * Note what is NOT a finding here: `stored` present with `truncated` absent, or the reverse. Those
 * are partial knowledge, which is exactly what the optional fields exist to express. Only a claim
 * that CONTRADICTS ITSELF is a defect.
 */
export function auditPageCoherence(page: QueryNodesPage): string[] {
	const findings: string[] = [];
	if (!Array.isArray(page.nodes)) {
		findings.push("nodes must be an array — a page with no rows is [], never absent");
		return findings;
	}
	if (typeof page.stored === "number") {
		if (page.stored < 0 || !Number.isInteger(page.stored)) {
			findings.push(`stored must be a non-negative integer, got ${page.stored}`);
		} else if (page.stored < page.nodes.length) {
			findings.push(
				`stored (${page.stored}) is below the rows delivered (${page.nodes.length}) — ` +
					"stored counts what EXISTS, independent of any limit, so it can never be the smaller number",
			);
		} else if (page.truncated === false && page.stored > page.nodes.length) {
			findings.push(
				`truncated: false claims the whole answer while stored (${page.stored}) exceeds the rows ` +
					`delivered (${page.nodes.length}). This is the one lie the type cannot prevent: every ` +
					"consumer, and readCompleteness itself, will read it as complete",
			);
		} else if (page.truncated === true && page.stored === page.nodes.length) {
			findings.push(
				`truncated: true claims rows are behind the edge while stored (${page.stored}) equals the ` +
					"rows delivered. Over-reporting truncation is milder than under-reporting it, but it is " +
					"still a measurement contradicting itself",
			);
		}
	}
	if (page.truncated !== undefined && typeof page.truncated !== "boolean") {
		findings.push(`truncated must be a boolean or absent, got ${typeof page.truncated}`);
	}
	return findings;
}

/** Three states, never two — the same discipline the thing under test is about.
 *  `unsupported` is NOT a pass: an adapter without `queryNodesPage` was not examined, and
 *  reporting that as green is precisely the collapse this whole family exists to stop. */
export type PageConformanceVerdict = "pass" | "fail" | "unsupported";

export interface PageConformanceResult {
	verdict: PageConformanceVerdict;
	failures: string[];
	/** What the run actually observed, so a reader can check the verdict rather than trust it. */
	observed?: { requested: number; delivered: number; stored?: number; truncated?: boolean };
}

/**
 * Exercises `queryNodesPage` against a live adapter by storing MORE rows than it then asks for.
 *
 * The seeding is the point. A page taken from a store that holds fewer rows than the limit is
 * coherent no matter what the adapter does — `truncated: false` is then simply true — so it proves
 * nothing. The only run that can catch the lie is one where the edge is known to have been crossed.
 */
export async function runQueryNodesPageConformance(
	adapter: StorageAdapter,
	options: { type?: string; seed?: number; limit?: number } = {},
): Promise<PageConformanceResult> {
	if (typeof adapter.queryNodesPage !== "function") {
		return {
			verdict: "unsupported",
			failures: [],
		};
	}

	const type = options.type ?? "conformance:page";
	const seed = options.seed ?? 5;
	const limit = options.limit ?? 2;
	const failures: string[] = [];

	try {
		await adapter.ensureSchema();
		for (let index = 0; index < seed; index += 1) {
			await adapter.storeNode(
				`${type}-${index}`,
				type,
				"conformance",
				JSON.stringify({ index }),
				null,
			);
		}
	} catch (error) {
		return { verdict: "fail", failures: [`seeding threw: ${String(error)}`] };
	}

	let page: QueryNodesPage;
	try {
		page = await adapter.queryNodesPage(type, { limit });
	} catch (error) {
		return { verdict: "fail", failures: [`queryNodesPage() threw: ${String(error)}`] };
	}

	failures.push(...auditPageCoherence(page));
	if (Array.isArray(page.nodes) && page.nodes.length > limit) {
		failures.push(`limit ${limit} was ignored — ${page.nodes.length} rows delivered`);
	}
	// The adapter is free to say "I cannot count" — but if it DID count, having just been given
	// more rows than it was asked for, the count must reflect them.
	if (typeof page.stored === "number" && page.stored < seed) {
		failures.push(`stored (${page.stored}) is below the ${seed} rows this run seeded`);
	}

	return {
		verdict: failures.length === 0 ? "pass" : "fail",
		failures,
		observed: {
			requested: limit,
			delivered: Array.isArray(page.nodes) ? page.nodes.length : -1,
			stored: page.stored,
			truncated: page.truncated,
		},
	};
}
