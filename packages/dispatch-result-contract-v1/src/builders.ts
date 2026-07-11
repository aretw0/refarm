import {
	DISPATCH_RESULT_TYPE,
	type DispatchResultInput,
	type DispatchResultNode,
} from "./types.js";

/**
 * Build a correlated async dispatch-result node — the ONE way a plugin emits a
 * store-node result, so producer and consumer share this shape instead of each
 * plugin reinventing it. The plugin passes the `replyRef` the caller submitted
 * with; the node's `@id` is derived from it so results are addressable and a
 * caller can find them by `query-nodes(DISPATCH_RESULT_TYPE)` then filter.
 */
export function buildDispatchResultNode(input: DispatchResultInput): DispatchResultNode {
	const node: DispatchResultNode = {
		"@type": DISPATCH_RESULT_TYPE,
		"@id": dispatchResultId(input.replyRef, input.verb),
		"replyRef": input.replyRef,
		"result": input.result,
	};
	if (input.verb !== undefined) node["verb"] = input.verb;
	return node;
}

/** The stable `@id` of a dispatch-result node:
 * `<DISPATCH_RESULT_TYPE>:<replyRef>[:<verb>]`. Deterministic, so a caller can
 * predict the id or match by field. */
export function dispatchResultId(replyRef: string, verb?: string): string {
	const base = `${DISPATCH_RESULT_TYPE}:${replyRef}`;
	return verb !== undefined ? `${base}:${verb}` : base;
}

/** Serialize a result node to the JSON string the tractor-bridge `store-node`
 * takes. A convenience for a plugin that emits through the bridge. */
export function serializeDispatchResult(input: DispatchResultInput): string {
	return JSON.stringify(buildDispatchResultNode(input));
}
