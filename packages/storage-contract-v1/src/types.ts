export const STORAGE_CAPABILITY = "storage:v1" as const;

export type StorageErrorCode =
	| "NOT_FOUND"
	| "CONFLICT"
	| "INVALID_INPUT"
	| "UNAVAILABLE"
	| "INTERNAL";

export interface StorageRecord {
	id: string;
	type: string;
	payload: string;
	createdAt: string;
	updatedAt: string;
}

export interface StorageQuery {
	type?: string;
	limit?: number;
	offset?: number;
	/** Return only records created after this ISO timestamp. */
	createdAfter?: string;
	/** Return only records created before this ISO timestamp. */
	createdBefore?: string;
}

export interface StorageTelemetryEvent {
	traceId: string;
	pluginId: string;
	capability: typeof STORAGE_CAPABILITY;
	operation: "get" | "put" | "put_many" | "delete" | "delete_many" | "query";
	durationMs: number;
	ok: boolean;
	errorCode?: StorageErrorCode;
}

export interface StorageProvider {
	readonly pluginId: string;
	readonly capability: typeof STORAGE_CAPABILITY;

	get(id: string): Promise<StorageRecord | null>;
	put(record: StorageRecord): Promise<void>;
	putMany(records: StorageRecord[]): Promise<void>;
	delete(id: string): Promise<void>;
	deleteMany(ids: string[]): Promise<void>;
	query(query: StorageQuery): Promise<StorageRecord[]>;
}

export interface StorageAdapter {
	ensureSchema(): Promise<void>;
	storeNode(
		id: string,
		type: string,
		context: string,
		payload: string,
		sourcePlugin: string | null,
	): Promise<void>;
	/**
	 * Every node of a type, as a bare list. UNCHANGED, and staying: for a caller that genuinely
	 * wants all of a small type, a list is the right answer and a page is ceremony.
	 *
	 * What it cannot do is say whether it gave you everything — see `queryNodesPage`.
	 */
	queryNodes(type: string): Promise<unknown[]>;
	/**
	 * The same read, with the facts that say whether it was COMPLETE.
	 *
	 * OPTIONAL, and that is a statement rather than a hedge: `queryNodesPage === undefined` is a
	 * readable answer — *this adapter cannot tell you whether the read was cut* — which is the
	 * third state of the family this contract is the root of (ISS-040). Fifteen files implement
	 * this interface; a REQUIRED method would force every one of them to invent
	 * `truncated: false`, the single value that must never be guessed.
	 *
	 * A consumer that needs to distinguish "there are none" from "I could not tell" checks for
	 * the method, calls it, and reads `readCompleteness`.
	 */
	queryNodesPage?(type: string, options?: QueryNodesOptions): Promise<QueryNodesPage>;
	execute(sql: string, args?: unknown): Promise<unknown>;
	query<T = unknown>(sql: string, args?: unknown): Promise<T[]>;
	transaction<T>(fn: () => Promise<T>): Promise<T>;
	close(): Promise<void>;
}

export interface QueryNodesOptions {
	/** How many rows to ask for. An adapter that cannot limit ignores it and reports the truth in
	 *  `truncated` — never by silently returning fewer. */
	limit?: number;
	/**
	 * How many rows to skip. THE REMEDY `truncated` USED TO LACK: a page that says it left rows
	 * out, on a transport with no way to ask for them, is an observation the caller cannot act on.
	 *
	 * NOT A CURSOR. A cursor needs a sort key stable under concurrent writes, which no adapter
	 * guarantees today. An offset is honest about what it is — adequate for paging a table, liable
	 * to skip or repeat a row if the set changes underneath the caller.
	 */
	offset?: number;
}

/**
 * A read, plus whether it was the whole answer.
 *
 * BOTH FACTS ARE OPTIONAL, TOGETHER, and for the reason `packages/sidecar-client` already carries
 * in a comment beside its own copy of this shape: a `stored` derived from `nodes.length` and a
 * `truncated` defaulted to `false` are GUESSES THAT READ AS MEASUREMENTS. Absent means absent.
 *
 * This type exists so that rule stops being one package's discipline. Nineteen consumer files
 * discard truncation today, and ISS-040's re-measurement is why: they discard it because the
 * contract had nowhere to put it. Structural, not careless.
 */
export interface QueryNodesPage {
	nodes: unknown[];
	/** How many of this type exist, independent of any limit. Absent when the adapter cannot count
	 *  without materialising the rows it is counting. */
	stored?: number;
	/**
	 * Whether rows remain BEYOND this page. Absent when the adapter cannot tell.
	 *
	 * WITH AN OFFSET IT IS NOT `stored > nodes.length`. Rows before the offset were skipped on
	 * purpose and are reachable by asking again, so counting them as withheld would leave a caller
	 * paging forever, one empty page at a time. The arithmetic is
	 * `stored > offset + nodes.length`, and the last page of a truncated read reports `false`.
	 */
	truncated?: boolean;
	/** Which row this page starts at, echoed back. Absent when the adapter does not page. */
	offset?: number;
}

/** What a page MEANS. `unknown` is not a failure — it is the honest verdict of an adapter that
 *  did not report, and the one state a caller must never collapse into `complete`. */
export type ReadCompleteness = "complete" | "partial" | "unknown";

/**
 * PURE. Three states, never two.
 *
 * The distinction the whole family turns on: an EMPTY `nodes` under `"unknown"` is *"nothing was
 * found in what I could see"*, not *"there are none"*. Collapsing those was how an older task
 * reported zero events as a fact to a model (ISS-045), and how a budget guard summed a
 * possibly-truncated set of usage records and concluded "under budget" either way.
 *
 * Mirrors `describe_event_completeness` in packages/agent/src/session/pure.rs — one vocabulary,
 * both stacks.
 *
 * It takes only `truncated` — a full `QueryNodesPage` satisfies that structurally, and so does a
 * caller whose page is named something else (`apps/refarm`'s `BudgetObservationsPage` calls its
 * rows `observations`). Widening the parameter to the whole page would have forced those callers
 * to build a throwaway object with a fake `nodes`, which is manufacturing data to satisfy a type.
 */
export function readCompleteness(page: Pick<QueryNodesPage, "truncated">): ReadCompleteness {
	if (page.truncated === true) return "partial";
	if (page.truncated === false) return "complete";
	return "unknown";
}

export interface StorageConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}
