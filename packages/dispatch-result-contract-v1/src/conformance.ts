import { buildDispatchResultNode, serializeDispatchResult } from "./builders.js";
import { matchDispatchResults } from "./match.js";
import { DISPATCH_RESULT_CAPABILITY, DISPATCH_RESULT_TYPE } from "./types.js";

export interface DispatchResultConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}

/**
 * Prove the dispatch-result:v1 round-trip: a producer builds a correlated result
 * node, and a consumer recovers exactly its own results by replyRef from a mixed
 * set — the enforced, content-based correlation ADR-084 relies on. Any store
 * (fs, SQLite, an in-memory array) that carries the emitted node JSON strings
 * back to the consumer satisfies this contract.
 */
export function runDispatchResultV1Conformance(): DispatchResultConformanceResult {
	const failures: string[] = [];

	// A producer emits two results under two different replyRefs.
	const a = serializeDispatchResult({ replyRef: "effort-1", verb: "extract", result: { n: 1 } });
	const b = serializeDispatchResult({ replyRef: "effort-2", verb: "search", result: { hits: [] } });
	const noise = JSON.stringify({ "@type": "SomethingElse", value: 1 });

	// The store hands everything back (query-nodes returns all of a @type; here we
	// simulate a mixed bag including a non-result node).
	const stored = [a, noise, b];

	const forOne = matchDispatchResults(stored, "effort-1");
	if (forOne.length !== 1) {
		failures.push(`consumer must recover exactly its own result (got ${forOne.length})`);
	}
	if (forOne[0]?.["result"] === undefined) {
		failures.push("recovered result must carry the payload");
	}
	if (forOne[0] && forOne[0]["replyRef"] !== "effort-1") {
		failures.push("recovered result must match the requested replyRef");
	}

	// A different caller recovers only its own.
	if (matchDispatchResults(stored, "effort-2").length !== 1) {
		failures.push("a second caller must recover only its own result");
	}

	// verb filter narrows within one replyRef.
	const both = serializeDispatchResult({ replyRef: "e3", verb: "extract", result: 1 });
	const other = serializeDispatchResult({ replyRef: "e3", verb: "profile", result: 2 });
	if (matchDispatchResults([both, other], "e3", "extract").length !== 1) {
		failures.push("verb filter must narrow within one replyRef");
	}

	// The node carries the canonical type + capability is stable.
	const node = buildDispatchResultNode({ replyRef: "x", result: 0 });
	if (node["@type"] !== DISPATCH_RESULT_TYPE) {
		failures.push(`node @type must be ${DISPATCH_RESULT_TYPE}`);
	}
	if (DISPATCH_RESULT_CAPABILITY !== "dispatch-result:v1") {
		failures.push("capability id must be dispatch-result:v1");
	}

	return {
		pass: failures.length === 0,
		total: 6,
		failed: failures.length,
		failures,
	};
}
