import {
	graphNodeToNormalised,
	type GraphNode,
	type NormalisedNode,
} from "@refarm.dev/node-contract-v1";
import type { KnowledgeRecord } from "@refarm.dev/records-contract-v1";

import { VAULT_CAPABILITY } from "./types.js";

/**
 * Project a `KnowledgeRecord` produced by the `extract` verb into the canonical
 * JSON-LD `NormalisedNode` the silo persists — the SAME shape
 * (`@context`/`@type`/`@id`/`sourcePlugin`) any producer emits, so an
 * extracted record enters the graph indistinguishably from a natively-authored
 * node. This is the OUTPUT half of vault:v1, proven without any runtime dispatch:
 * a record → node projection the host runs after a surface returns records.
 *
 * The projection is `KnowledgeRecord → GraphNode → NormalisedNode`:
 *   - `record.id`      → node `@id`
 *   - `record["@type"]`→ node `@type` (defaults to `refarm:VaultRecord`)
 *   - `fields`/`sections`/`relations`/`attachments`/`sourceRefs`/`contentHash`
 *     ride through as open domain fields (NormalisedNode is open by design).
 *
 * WHY the host supplies the timestamp: `graphNodeToNormalised` requires
 * `created_at_ns`, but a vault surface is pure compute with NO clock (its WASM
 * world imports nothing). So the HOST stamps `createdAtNs` at emit time — the
 * surface never reads a clock, preserving the sandbox.
 */
export interface VaultEmitOptions {
	/** Nanoseconds since the Unix epoch, stamped by the HOST (the surface has no
	 * clock). Becomes `createdAt` (ISO) on the node. */
	createdAtNs: number;
	/** The plugin id that produced the record → `sourcePlugin`. */
	sourcePlugin?: string;
	/** JSON-LD `@context`; defaults to schema.org via graphNodeToNormalised. */
	context?: string | Record<string, string>;
	/** The context/workspace id → `context`. */
	contextId?: string | null;
}

/** The `@type` an extracted vault record carries when the profile didn't set one. */
export const DEFAULT_VAULT_RECORD_TYPE = "refarm:VaultRecord";

/**
 * Turn a vault `KnowledgeRecord` into the `GraphNode` the graph domain uses.
 * `@type`/`@id` map straight across; the record's structured payload rides as
 * open domain fields (NormalisedNode stays open, so no field is lost). A record
 * may carry a `@type` array (records-contract-v1 allows it); the node type is a
 * single string, so an array collapses to its first entry with the whole array
 * preserved under `refarm:types`.
 */
export function vaultRecordToGraphNode(
	record: KnowledgeRecord,
	options: VaultEmitOptions,
): GraphNode {
	const { id, "@type": recordType, "@context": _recordContext, ...payload } = record;
	const type = normaliseType(recordType);
	// GraphNode is a CLOSED domain shape (no index signature), but its open
	// transport sibling NormalisedNode carries any extra field — so `@type` array
	// preservation and capability provenance are stamped in vaultRecordToNode,
	// not here. The domain node stays minimal and typed.
	return {
		"@type": type.type,
		"@id": id,
		created_at_ns: options.createdAtNs,
		...(options.contextId !== undefined ? { context_id: options.contextId } : {}),
		...payload,
	};
}

/**
 * The full OUTPUT projection: a vault `KnowledgeRecord` → the canonical
 * `NormalisedNode` the silo stores. Composes {@link vaultRecordToGraphNode} with
 * `graphNodeToNormalised`, so the node carries `@context`/`@type`/`@id` +
 * `createdAt`/`sourcePlugin` exactly like every other producer.
 */
export function vaultRecordToNode(
	record: KnowledgeRecord,
	options: VaultEmitOptions,
): NormalisedNode {
	const node = graphNodeToNormalised(vaultRecordToGraphNode(record, options), {
		context: options.context,
		sourcePlugin: options.sourcePlugin,
	});
	// Provenance + @type-array preservation live on the OPEN transport node.
	node["refarm:capability"] = VAULT_CAPABILITY;
	const all = normaliseType(record["@type"]).all;
	if (all) node["refarm:types"] = all;
	return node;
}

function normaliseType(recordType: KnowledgeRecord["@type"]): { type: string; all?: string[] } {
	if (typeof recordType === "string") return { type: recordType };
	if (Array.isArray(recordType) && recordType.length > 0) {
		return { type: recordType[0] as string, all: [...recordType] };
	}
	return { type: DEFAULT_VAULT_RECORD_TYPE };
}
