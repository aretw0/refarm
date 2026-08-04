// Node-name-suggestion doctor finding — this node has an opaque identity but no
// operator-chosen label, and until now nothing said so at start-up.
//
// `node_identity.rs` gave every node two identifiers: an opaque `host.id`, minted once and
// never travelling, and a declared `host.name`, human-chosen and absent until the operator
// sets `node.name` in the sovereign config.json. Two nodes can legitimately share a name —
// collision is made HARMLESS, not prevented (see `budget.ts`'s `summariseObservations`,
// which keys the BudgetObservation record on `host.id` for exactly this reason: name
// collision cannot be forbidden in a coordinator-less mesh). What still helps the operator
// is picking a name unlikely to collide in the first place, and the friendliest place to
// say so is where the node already tells the operator about itself at start-up: `refarm
// doctor`, alongside `scope-doctor.ts`'s "the node answers from a different directory than
// you're standing in" finding — the same shape of unprompted, courtesy TELL, not an ASK.
//
// DECLARED, NEVER DETECTED (docs/superpowers/specs/2026-08-03-declared-node-base-design.md):
// this is a SUGGESTION, never a write. The suggested value is only shown; nothing in this
// module touches config.json, and the node keeps recording an absent `host.name` on every
// observation until a human declares one. The suggestion is built from the node's OWN
// opaque id — never from hostname, machine-id, or any other environment probe — because
// deriving identity from something detectable is exactly the class of lie the declared-base
// program exists to refuse, and a silently-plausible SUGGESTION would still train the
// operator to trust a detected value instead of a declared one.
//
// NO finding fires for: a node that already declared a name (nothing to suggest), a node
// with no opaque id yet (nothing to build a suggestion FROM — see node_identity.rs's
// "could not persist" case), or no running node at all (the descriptor is `null`; this
// finding is about a LIVE node's own self-report, not a guess about one that might exist).
//
// Pure over an already-resolved descriptor, exactly like `scope-doctor.ts` and
// `connection-doctor.ts` — this never touches the filesystem itself, so every test drives
// it with a literal.

import type { RefarmDoctorRecommendation } from "./doctor.js";

/** How much of the opaque id rides the suggestion — enough to tell two nodes' suggestions
 *  apart at a glance without printing the whole uuid into every doctor run. */
const SUGGESTED_NAME_ID_SLICE_LENGTH = 6;

/**
 * A name unlikely to collide with another node's, built from this node's own opaque id —
 * never from anything about the environment (see the module doc's "declared, never
 * detected"). PURE.
 */
export function suggestNodeName(nodeId: string): string {
	return `node-${nodeId.slice(0, SUGGESTED_NAME_ID_SLICE_LENGTH)}`;
}

/** The subset of `NodeDescriptor` (`../utils/node-descriptor.ts`) this finding reads — kept
 *  narrow so a test can express "the running node has an id and no name" with a literal,
 *  not the full descriptor shape (declarationBase, sovereignDir, pid, startedAt). */
export interface NodeIdentitySnapshot {
	nodeName?: string;
	nodeId?: string;
}

/**
 * Build the `refarm doctor` finding for a running node that has not declared a name.
 * Pure — the caller resolves the descriptor (see `doctor.ts`'s `resolveNodeDescriptor`).
 */
export function buildNodeNameDoctorRecommendations(
	descriptor: NodeIdentitySnapshot | null,
): RefarmDoctorRecommendation[] {
	if (!descriptor) return [];
	if (descriptor.nodeName) return [];
	if (!descriptor.nodeId) return [];

	const suggestion = suggestNodeName(descriptor.nodeId);
	return [
		{
			diagnostic: "node:unnamed",
			severity: "warning",
			summary:
				"This node has not declared a name (config.json's node.name) — BudgetObservation " +
				"records from it read as an unnamed node until one is set, and two unnamed nodes " +
				"are harder to tell apart than two named ones.",
			action:
				`Set node.name to "${suggestion}" in the sovereign config.json — ` +
				`add "node": { "name": "${suggestion}" } (a sibling of "surfaces" and "budget"). ` +
				"This is a SUGGESTION built from this node's own id, unlikely to collide with " +
				"another node's declared name — refarm never writes it for you, and this node keeps " +
				"recording no name until you declare one, with any value you prefer.",
		},
	];
}
