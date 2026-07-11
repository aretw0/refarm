import { DISPATCH_RESULT_TYPE, type DispatchResultNode } from "./types.js";

/**
 * The consumer side: recover correlated results from what `query-nodes` returns.
 * A caller runs `query-nodes(DISPATCH_RESULT_TYPE)` (the host reads every stored
 * dispatch-result node), then uses these to keep only its own results by
 * `replyRef` — enforced by content, no derived-filename convention to get wrong.
 */

/** Type-guard: is this parsed JSON a dispatch-result node? */
export function isDispatchResultNode(value: unknown): value is DispatchResultNode {
	if (!value || typeof value !== "object") return false;
	const node = value as Record<string, unknown>;
	return node["@type"] === DISPATCH_RESULT_TYPE && typeof node["replyRef"] === "string";
}

/** Parse a stored node JSON string into a DispatchResultNode, or undefined if it
 * is not one (malformed or a different @type). Never throws. */
export function parseDispatchResult(nodeJson: string): DispatchResultNode | undefined {
	try {
		const parsed = JSON.parse(nodeJson) as unknown;
		return isDispatchResultNode(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/**
 * From the raw node JSON strings `query-nodes` returned, keep only the
 * dispatch-result nodes matching `replyRef` (and optionally a specific `verb`),
 * in store order. This is how a caller correlates async results back to its
 * request — the enforced, content-based correlation the STREAM model lacks.
 */
export function matchDispatchResults(
	nodeJsons: readonly string[],
	replyRef: string,
	verb?: string,
): DispatchResultNode[] {
	const matched: DispatchResultNode[] = [];
	for (const json of nodeJsons) {
		const node = parseDispatchResult(json);
		if (!node) continue;
		if (node["replyRef"] !== replyRef) continue;
		if (verb !== undefined && node["verb"] !== verb) continue;
		matched.push(node);
	}
	return matched;
}
