/**
 * Graph Normaliser (runtime side)
 *
 * Normalise raw data from a plugin into a JSON-LD node before writing it to the
 * local SQLite graph.
 *
 * The node TYPES (NormalisedNode, Signature) and the pure adapters live in
 * `@refarm.dev/node-contract-v1` — the single source of truth shared with the
 * domain GraphNode and honoured by the Rust write path
 * (packages/tractor/src/storage/sqlite.rs, packages/agent/src/session/pure.rs).
 * This module re-exports them so existing importers keep working, and owns only
 * the runtime `normaliseToGraph` function (which uses crypto.randomUUID and the
 * wall clock — runtime concerns that do not belong in a pure contract).
 *
 * See /schemas/sovereign-graph.jsonld for the full schema example.
 */

import type { NormalisedNode } from "@refarm.dev/node-contract-v1";

export type { NormalisedNode, Signature } from "@refarm.dev/node-contract-v1";

export function normaliseToGraph(
	raw: Record<string, unknown>,
	pluginId: string,
	type: string,
): NormalisedNode {
	const id = (raw["@id"] as string | undefined) ?? `urn:refarm:${pluginId}:${crypto.randomUUID()}`;

	const now = new Date().toISOString();

	return {
		...raw,
		"@context": "https://schema.org/",
		"@type": type,
		"@id": id,
		"sourcePlugin": pluginId,
		"ingestedAt": now,
		"createdAt": (raw["createdAt"] as string) || now,
		"updatedAt": now,
		"refarm:clock": (raw["refarm:clock"] as number) || 0,
	};
}
