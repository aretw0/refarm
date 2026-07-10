import type { GraphNode } from "./index.js";

/**
 * NormalisedNode — the transport/persistence envelope around a graph node.
 *
 * WHY THIS LIVES HERE (node-contract-v1 is the single source of truth):
 * a graph node has two faces that used to drift apart —
 *   - {@link GraphNode} (this package): the *domain* shape that typed
 *     contracts (task, session, effort…) extend — `@type`/`@id` + semantic
 *     fields, `created_at_ns` in nanoseconds.
 *   - NormalisedNode (formerly defined independently in tractor-ts): the
 *     *transport* envelope written to the SQLite graph and carried over the
 *     WIT `json-ld-node = string` boundary — adds `@context`, a signature
 *     envelope, ingestion/clock metadata, and stays OPEN (index signature) so
 *     any plugin can emit any `@type` with any fields.
 *
 * The WIT boundary deliberately keeps the wire type a JSON-LD *string*, which
 * is what makes the graph extensible: a plugin (Rust, TS, worker, wasm) emits
 * any node type without changing the contract. This TS envelope is the
 * *optional* typed view of that open string — schema-on-read, not
 * schema-on-wire. See docs/EXTENSIBILITY_MODEL.md and ADR-059.
 *
 * The Rust host owns the authoritative write path
 * (`packages/tractor/src/storage/sqlite.rs`) and emits the SAME field names by
 * convention. `normalised.conformance.ts` pins those field names so the
 * cross-language convention cannot silently drift.
 */
export interface NormalisedNode {
	"@context": string | Record<string, string>;
	"@type": string;
	"@id": string;
	"refarm:signature"?: Signature;
	"refarm:signatures"?: Signature[];
	/** Open by design: any plugin may attach any additional JSON-LD fields. */
	[key: string]: unknown;
}

/**
 * Ed25519-style signature envelope. Declared here as an inert data shape — the
 * crypto that fills it lives behind the heartwood WASM bridge and is NOT
 * invoked by this contract (a node may be unsigned).
 */
export interface Signature {
	pubkey: string;
	sig: string;
	alg: string;
}

/** Nanoseconds since the Unix epoch → ISO-8601 string (millisecond precision). */
export function nanosToIso(createdAtNs: number): string {
	const ms = Math.floor(createdAtNs / 1_000_000);
	return new Date(ms).toISOString();
}

/** ISO-8601 string → nanoseconds since the Unix epoch. */
export function isoToNanos(iso: string): number {
	return Date.parse(iso) * 1_000_000;
}

/**
 * Project a domain {@link GraphNode} into a transport {@link NormalisedNode}.
 *
 * Reconciles the two representations that used to diverge:
 *   - `created_at_ns` (nanoseconds number) → `refarm:createdAt` (ISO string).
 *   - `context_id` → `refarm:context`.
 * Domain fields (title/body/tags/priority) are carried through untouched.
 */
export function graphNodeToNormalised(
	node: GraphNode,
	options: { context?: string | Record<string, string>; sourcePlugin?: string } = {},
): NormalisedNode {
	const { created_at_ns, context_id, ...rest } = node;
	const normalised: NormalisedNode = {
		...rest,
		"@context": options.context ?? "https://schema.org/",
		"@type": node["@type"],
		"@id": node["@id"],
		"refarm:createdAt": nanosToIso(created_at_ns),
	};
	if (context_id !== undefined && context_id !== null) {
		normalised["refarm:context"] = context_id;
	}
	if (options.sourcePlugin !== undefined) {
		normalised["refarm:sourcePlugin"] = options.sourcePlugin;
	}
	return normalised;
}

/**
 * Recover a domain {@link GraphNode} from a transport {@link NormalisedNode}.
 *
 * The inverse of {@link graphNodeToNormalised}: reads `refarm:createdAt` (ISO)
 * back into `created_at_ns` (nanoseconds), and `refarm:context` into
 * `context_id`. Transport-only fields (`@context`, signatures, clock) are
 * dropped. Unknown domain fields on the open node are preserved.
 */
export function normalisedToGraphNode(node: NormalisedNode): GraphNode {
	const createdAtIso = node["refarm:createdAt"];
	const created_at_ns = typeof createdAtIso === "string" ? isoToNanos(createdAtIso) : 0;

	const context = node["refarm:context"];
	const graph: GraphNode = {
		"@type": node["@type"],
		"@id": node["@id"],
		created_at_ns,
	};
	if (typeof context === "string") graph.context_id = context;
	if (typeof node.title === "string") graph.title = node.title;
	if (typeof node.body === "string") graph.body = node.body;
	if (Array.isArray(node.tags)) graph.tags = node.tags as string[];
	if (typeof node.priority === "number") graph.priority = node.priority;
	return graph;
}
