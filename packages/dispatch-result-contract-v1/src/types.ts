/**
 * dispatch-result:v1 — the neutral contract for the ASYNCHRONOUS store-node
 * result envelope. Per ADR-084, async is the default plugin dispatch model: a
 * plugin runs work off `on-event` and, because `on-event` returns nothing, emits
 * its result OUT as a graph node the caller reads back. This contract is that
 * node's shape — the store-node sibling of stream-contract-v1 (which is the
 * incremental STREAM model).
 *
 * WHY THIS EXISTS: the first async store-node plugin (vault) invented an ad-hoc
 * `@type` + `replyRef` inline. Without a shared contract, every next plugin
 * reinvents the correlation shape and callers hand-parse untyped nodes (the
 * "no typed channel" debt). This formalizes it ONCE: a stable `@type`, a typed
 * `refarm:replyRef` that ties the result to the effort/task that requested it,
 * and helpers so producer and consumer share one implementation.
 *
 * CORRELATION IS BY CONTENT, NOT A DERIVED FILENAME: the caller submits with a
 * `replyRef` (typically the `effortId` or `<effortId>:<taskId>`), the plugin
 * stamps it on the result node, and the host reads results back with
 * `query-nodes(@type)` — enforced by the store, no fragile naming formula (the
 * failure mode the STREAM model still has). A second plugin cannot silently
 * desync because there is no formula to get wrong.
 */
export const DISPATCH_RESULT_CAPABILITY = "dispatch-result:v1" as const;

/** The canonical `@type` of an async dispatch-result node. A caller queries this
 * type and filters by `refarm:replyRef`. */
export const DISPATCH_RESULT_TYPE = "refarm:DispatchResult" as const;

/** The node field carrying the correlation id — the `effortId` (or
 * `<effortId>:<taskId>`) the caller submitted with, so a result maps back to its
 * request with no derived-filename convention. */
export const REPLY_REF_FIELD = "refarm:replyRef" as const;

/** The node field naming the capability/verb that produced the result, for a
 * caller that dispatched several verbs under one replyRef. */
export const RESULT_VERB_FIELD = "refarm:verb" as const;

/** The node field carrying the plugin-specific result payload. */
export const RESULT_PAYLOAD_FIELD = "refarm:result" as const;

/**
 * The async dispatch-result node — an open JSON-LD node (any plugin may add
 * fields) with a fixed correlation core. Emitted via `tractor-bridge store-node`;
 * read back via `query-nodes(DISPATCH_RESULT_TYPE)` then filtered by `replyRef`.
 */
export interface DispatchResultNode {
	"@type": typeof DISPATCH_RESULT_TYPE;
	/** Stable, queryable id: `<DISPATCH_RESULT_TYPE>:<replyRef>[:<verb>]`. */
	"@id": string;
	/** The correlation id tying this result to the request that produced it. */
	"refarm:replyRef": string;
	/** The verb/operation that produced this result (optional; for multi-verb). */
	"refarm:verb"?: string;
	/** The plugin-specific result payload (the VaultResult, a findings list, …). */
	"refarm:result": unknown;
	/** Open by design: a plugin may attach any additional JSON-LD fields. */
	[key: string]: unknown;
}

/** The inputs a plugin needs to build a correlated result node. */
export interface DispatchResultInput {
	/** The correlation id the caller submitted with (effortId or effortId:taskId). */
	replyRef: string;
	/** The verb/operation that produced the result (optional). */
	verb?: string;
	/** The plugin-specific result payload. */
	result: unknown;
}
