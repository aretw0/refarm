export const NODE_CAPABILITY = "node:v1" as const;

/**
 * Base shape for all typed nodes in the Refarm sovereign data graph.
 *
 * Uses JSON-LD conventions (@type, @id) so nodes are serialisable to
 * linked-data formats without transformation.
 *
 * Domain contracts (task, session, effort, …) extend this interface and
 * narrow or add fields as needed. Optional fields here can be tightened
 * to required in the extending interface.
 */
export interface GraphNode {
	"@type": string;
	"@id": string;
	/** Human-readable display label. */
	title?: string;
	/** Longer free-text description or content. */
	body?: string;
	/** Arbitrary categorisation labels. */
	tags?: string[];
	/** Relative ordering hint. Lower number = higher priority. */
	priority?: number;
	/** The context/workspace this node belongs to, or null for global. */
	context_id?: string | null;
	/** Creation timestamp in nanoseconds since Unix epoch. */
	created_at_ns: number;
}
