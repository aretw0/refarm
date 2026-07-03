import type { NormalisedNode } from "@refarm.dev/node-contract-v1";
import type { StorageProvider } from "@refarm.dev/storage-contract-v1";

import { nodeToRecord, recordToNode } from "./record-node.js";

/**
 * NodeView — a stateless node-graph face over any StorageProvider.
 *
 * Wraps a plain record store (fs, memory, sqlite records) so callers can read
 * and write NODES while the underlying store keeps flat StorageRecords. This is
 * the operational proof of "a ledger is a set of nodes": the same backend
 * serves ledger records (via the provider directly) AND typed nodes (via this
 * view), over the same bytes.
 *
 * Deliberately does NOT expose SQL / transactions / CRDT sync — those belong to
 * the graph StorageAdapter and the Rust-authoritative store (ADR-059), not to a
 * ledger. This view stays on the record side of that boundary.
 */
export class NodeView {
	private readonly provider: StorageProvider;
	/** Injected clock so the pure adapters stay deterministic in tests. */
	private readonly now: () => string;

	constructor(
		provider: StorageProvider,
		options: { now?: () => string } = {},
	) {
		this.provider = provider;
		this.now = options.now ?? (() => new Date().toISOString());
	}

	/** Store (upsert) a node as a flat record in the underlying provider. */
	async storeNode(node: NormalisedNode): Promise<void> {
		await this.provider.put(nodeToRecord(node, this.now()));
	}

	/** Read a node back by its @id, or null if absent. */
	async getNode(id: string): Promise<NormalisedNode | null> {
		const record = await this.provider.get(id);
		return record ? recordToNode(record) : null;
	}

	/** Query nodes by @type (maps to the record `type` column). */
	async queryNodes(type: string): Promise<NormalisedNode[]> {
		const records = await this.provider.query({ type });
		return records.map(recordToNode);
	}
}

/** Wrap a StorageProvider in a node-graph face. */
export function createNodeView(
	provider: StorageProvider,
	options?: { now?: () => string },
): NodeView {
	return new NodeView(provider, options);
}
