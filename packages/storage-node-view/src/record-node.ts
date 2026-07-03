import type { NormalisedNode } from "@refarm.dev/node-contract-v1";
import type { StorageRecord } from "@refarm.dev/storage-contract-v1";

/**
 * Pure record⇄node adapter.
 *
 * A ledger record and a graph node are the SAME data: a StorageRecord is a
 * NormalisedNode with its identity/time surfaced as flat columns and its body
 * (JSON-LD @context, provenance, domain fields, signature envelope) carried in
 * `payload`. This module makes that equivalence a total, lossless projection,
 * so any StorageProvider (fs, memory, sqlite records) can also serve nodes —
 * "a ledger is just a set of nodes; only where/when they're written differs".
 *
 * This is TS-only, on the record/ledger side of the ADR-059 boundary. It NEVER
 * touches the Rust-authoritative graph store (packages/tractor storage/sqlite.rs)
 * or the Loro CRDT sync path — a StorageProvider flat backend has neither a
 * `nodes`/`crdt_log` schema nor a peer sync model. See ADR-083-adjacent design
 * notes and node-contract-v1's normalised.ts (the graphNode⇄normalised half of
 * the same equivalence).
 */

/** JSON-LD @context default, matching the `nodes.context` column default. */
const DEFAULT_CONTEXT = "https://schema.org/";

/**
 * Project a NormalisedNode into a flat StorageRecord.
 *
 * Lossless: `@id`/`@type` surface as `id`/`type`; the ENTIRE node (including
 * `@context`, `refarm:*` provenance, domain fields, signatures) is serialized
 * into `payload`, so `recordToNode` recovers it exactly. `refarm:createdAt` /
 * `refarm:updatedAt` (ISO strings the node already carries) become the record's
 * timestamps; both default to `now` (an ISO string the caller supplies) when
 * the node has not set them.
 */
export function nodeToRecord(
	node: NormalisedNode,
	now: string,
): StorageRecord {
	const createdAt =
		typeof node["refarm:createdAt"] === "string"
			? (node["refarm:createdAt"] as string)
			: now;
	const updatedAt =
		typeof node["refarm:updatedAt"] === "string"
			? (node["refarm:updatedAt"] as string)
			: now;

	// The full node lives in payload so nothing is lost across the flat record.
	const body: NormalisedNode = {
		...node,
		"@context": node["@context"] ?? DEFAULT_CONTEXT,
	};

	return {
		id: node["@id"],
		type: node["@type"],
		payload: JSON.stringify(body),
		createdAt,
		updatedAt,
	};
}

/**
 * Recover a NormalisedNode from a flat StorageRecord.
 *
 * The inverse of {@link nodeToRecord}: the node is parsed back from `payload`
 * (the lossless carrier), with `@id`/`@type` and the record timestamps
 * reconciled against the parsed body. A record whose payload is not a JSON-LD
 * node (e.g. a plain string ledger value) is wrapped into a minimal node so the
 * projection is still total.
 */
export function recordToNode(record: StorageRecord): NormalisedNode {
	let parsed: Record<string, unknown> | null = null;
	try {
		const value = JSON.parse(record.payload) as unknown;
		if (value && typeof value === "object" && !Array.isArray(value)) {
			parsed = value as Record<string, unknown>;
		}
	} catch {
		parsed = null;
	}

	const base: NormalisedNode =
		parsed && typeof parsed["@id"] === "string"
			? (parsed as NormalisedNode)
			: {
					"@context": DEFAULT_CONTEXT,
					"@type": record.type,
					"@id": record.id,
					// Non-node payloads (opaque ledger values) are preserved verbatim.
					"refarm:payload": record.payload,
				};

	// The flat columns are authoritative for id/type/time on the way out.
	return {
		...base,
		"@type": record.type,
		"@id": record.id,
		"refarm:createdAt": base["refarm:createdAt"] ?? record.createdAt,
		"refarm:updatedAt": record.updatedAt,
	};
}
