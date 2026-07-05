import { serializeDispatchResult } from "./builders.js";
import {
	matchDispatchResults,
	parseDispatchResult,
} from "./match.js";
import {
	DISPATCH_RESULT_TYPE,
	type DispatchResultInput,
	type DispatchResultNode,
} from "./types.js";

/**
 * The reference in-memory store for dispatch-result:v1 — the test double a
 * consumer (or a plugin harness) uses in place of the real tractor-bridge. It
 * captures emitted node JSON strings on `storeNode` and answers `queryNodes`
 * exactly like the host (`query-nodes(@type)` over the store), so a plugin's
 * emit → correlate round-trip can be exercised without the runtime. This is the
 * shape the vault plugin test's functional bridge implements, promoted to a
 * shared adapter so every async plugin's test reuses it.
 */
export interface InMemoryDispatchResultStore {
	/** The bridge-facing sink a plugin emits through. */
	storeNode(nodeJson: string): string;
	/** The bridge-facing query a caller reads results back with. */
	queryNodes(nodeType: string, limit?: number): string[];
	/** Convenience: emit a correlated result node in one call. */
	emit(input: DispatchResultInput): void;
	/** Convenience: recover this caller's results by replyRef (and optional verb). */
	resultsFor(replyRef: string, verb?: string): DispatchResultNode[];
	/** Every stored node JSON, in store order. */
	readonly stored: readonly string[];
}

export function createInMemoryDispatchResultStore(): InMemoryDispatchResultStore {
	const stored: string[] = [];
	return {
		stored,
		storeNode(nodeJson: string): string {
			stored.push(nodeJson);
			return `node:${stored.length}`;
		},
		queryNodes(nodeType: string, limit?: number): string[] {
			const rows = stored.filter((json) => {
				const node = parseDispatchResult(json);
				if (node) return nodeType === DISPATCH_RESULT_TYPE;
				try {
					return (JSON.parse(json) as { "@type"?: string })["@type"] === nodeType;
				} catch {
					return false;
				}
			});
			return limit === undefined ? rows : rows.slice(0, limit);
		},
		emit(input: DispatchResultInput): void {
			stored.push(serializeDispatchResult(input));
		},
		resultsFor(replyRef: string, verb?: string): DispatchResultNode[] {
			return matchDispatchResults(stored, replyRef, verb);
		},
	};
}
