import type { GraphInput, GraphLink } from "./layout.js";

/**
 * The SOVEREIGN-GRAPH traversal axis — map the nodes in a real store (a ledger / node-view over
 * the Sovereign Graph) into a `{nodes, links}` graph + statistics. Where `graphFromRecords` works
 * off records already in memory, THIS reads from the store: it is the TS realization of the
 * Surveyor's `mapper` (`get-stats` / `query-by-type` / `get-connections`), so a graph can be
 * traversed from the source of truth, not just a pre-loaded list.
 *
 * The store is behind a minimal `NodeSource` (so `@refarm.dev/storage-node-view`'s NodeView
 * satisfies it structurally, with no hard dependency), and edge encoding — which JSON-LD fields
 * of a node point at other nodes — is an injected `resolveConnections`, since that is domain data
 * (a `related`/`references`/`links-to` field). The traversal (query → resolve edges → degree) is
 * the substrate's; the connection convention is the consumer's.
 */

/** A node as the store hands it back: JSON-LD with an `@id`, an `@type`, and open fields. */
export interface SovereignNode {
	"@id": string;
	"@type"?: string;
	[key: string]: unknown;
}

/** The minimal store the traversal reads — a subset of a NodeView. `queryNodes(type)` lists nodes
 * of a schema type; `getNode(id)` fetches one (for on-demand neighbor expansion). Structural, so a
 * real NodeView (or an in-memory fake in a test) satisfies it with no adapter. */
export interface NodeSource {
	queryNodes(type: string): Promise<SovereignNode[]>;
	getNode?(id: string): Promise<SovereignNode | null>;
}

/** Extract the ids this node connects to — the domain's edge convention (a `related: [...]`, a
 * `references` field, a `links-to`). The substrate never guesses; the consumer supplies this. */
export type ResolveConnections = (node: SovereignNode) => string[];

/** Graph statistics — the Surveyor's `get-stats`. */
export interface GraphStats {
	nodeCount: number;
	edgeCount: number;
	/** Distinct @type values present (a rough "how many kinds of thing"). */
	typeCount: number;
}

export interface TraverseOptions {
	/** The @type(s) to pull as the graph's nodes. A single type or several unioned. */
	types: string | readonly string[];
	/** How to read a node's outgoing connections (the domain edge fields). */
	resolveConnections: ResolveConnections;
	/** Keep an edge only when BOTH endpoints are in the queried node set (default true). False
	 * keeps an edge to a node outside the set (a dangling reference recorded, not drawn). */
	requireResolvedTarget?: boolean;
}

/** A traversed graph: the `{nodes, links}` for the layout + the stats. */
export interface TraversedGraph extends GraphInput {
	links: GraphLink[];
	stats: GraphStats;
	/** The raw nodes, keyed by id, for a consumer that wants the JSON-LD (labels, fields). */
	byId: Map<string, SovereignNode>;
}

/**
 * Traverse a store into a graph: query the node set by `@type`, resolve each node's connections
 * to edges (dropping danglers unless asked to keep them), compute degree for sizing, and tally
 * stats. Reads from the source of truth. The result feeds `layoutGraph` / `graphToSvg` directly.
 */
export async function traverseGraph(source: NodeSource, options: TraverseOptions): Promise<TraversedGraph> {
	const types = typeof options.types === "string" ? [options.types] : [...options.types];
	const requireResolved = options.requireResolvedTarget !== false;

	// Query the node set (union across types), deduped by @id.
	const byId = new Map<string, SovereignNode>();
	for (const type of types) {
		for (const node of await source.queryNodes(type)) {
			if (node && node["@id"]) byId.set(node["@id"], node);
		}
	}

	// Resolve edges from each node's connection fields.
	const links: GraphLink[] = [];
	const seen = new Set<string>();
	for (const node of byId.values()) {
		for (const target of options.resolveConnections(node)) {
			if (target === node["@id"]) continue; // no self-loops
			if (requireResolved && !byId.has(target)) continue; // dangler → dropped
			const key = `${node["@id"]} ${target}`;
			if (seen.has(key)) continue;
			seen.add(key);
			links.push({ source: node["@id"], target });
		}
	}

	// Degree (in + out) for sizing.
	const degree = new Map<string, number>([...byId.keys()].map((id) => [id, 0]));
	for (const link of links) {
		degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
		if (degree.has(link.target)) degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
	}

	const typeSet = new Set<string>();
	for (const node of byId.values()) if (node["@type"]) typeSet.add(node["@type"]);

	return {
		nodes: [...byId.keys()].map((id) => ({ id, degree: degree.get(id) ?? 0 })),
		links,
		stats: { nodeCount: byId.size, edgeCount: links.length, typeCount: typeSet.size },
		byId,
	};
}

/**
 * `get-connections` for one node — its immediate neighbors (out via the resolver, in by scanning
 * the queried set). A view that expands a node on click uses this. Reads the same store.
 */
export async function getConnections(
	source: NodeSource,
	id: string,
	options: TraverseOptions,
): Promise<{ outgoing: string[]; incoming: string[] }> {
	const graph = await traverseGraph(source, options);
	const outgoing = graph.links.filter((l) => l.source === id).map((l) => l.target);
	const incoming = graph.links.filter((l) => l.target === id).map((l) => l.source);
	return { outgoing, incoming };
}
