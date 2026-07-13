/**
 * The headless FORCE-DIRECTED layout kernel — the pure physics that places a graph's nodes in
 * 2D space, with NO DOM and NO framework. A render layer (SVG in a browser, a canvas, a test)
 * consumes the resulting coordinates; this module only does the math.
 *
 * Ported faithfully from the vault-seed graph engine's `computeForces` + integration loop (the
 * zero-dependency hand-rolled simulation that powered its rich web graph), extracted here as a
 * substrate block so ANY Sovereign-Graph view — the Surveyor's own, an app, an agent's — reuses
 * the same well-tuned physics instead of re-deriving repulsion/spring constants. The formulas and
 * constants are the original's; the shape is typed and the seeding is deterministic (a per-id
 * hash, never Math.random) so a layout is reproducible and unit-testable.
 */

/** The viewport the simulation lays out into (a square). The original used 200. */
export const VIEWBOX_SIZE = 200;

/** The tuned simulation constants (the vault-seed engine's values). */
export const LAYOUT_DEFAULTS = {
	forceSteps: 80,
	repulsionForce: 2400,
	springForce: 0.013,
	centerForce: 0.001,
	damping: 0.8,
	maxNodeVelocity: 1.05,
	/** Ideal extra gap between two connected nodes, added to their radii → the spring rest length. */
	edgeIdealGap: 44,
} as const;

/** A node the simulation moves: identity + degree (drives size) + live position/velocity. The
 * caller seeds position/velocity via `seedLayout`; `size` derives from degree. */
export interface LayoutNode {
	id: string;
	/** Connection count — drives the node radius (a hub is bigger) and the seed order. */
	degree: number;
	x: number;
	y: number;
	vx: number;
	vy: number;
	/** The node radius, used as the spring rest length and the constrain margin. */
	size: number;
}

/** An edge between two node ids — the spring. */
export interface GraphLink {
	source: string;
	target: string;
}

/** Options for one `computeForces` pass — the subset the layout uses (the original had more knobs
 * for its focus/hover modes; those can be layered later). */
export interface ComputeForcesOptions {
	repulsionForce?: number;
	springForce?: number;
	edgeIdealGap?: number;
	/** 'explorer' = ~1/r³ falloff (spreads a dense graph); 'hero' = inverse-square 1/r². */
	repulsionMode?: "explorer" | "hero";
}

function clamp(value: number, min: number, max: number): number {
	const safeMin = Number.isFinite(min) ? min : value;
	const safeMax = Number.isFinite(max) ? max : value;
	return Math.min(safeMax, Math.max(safeMin, value));
}

/** The node radius from its degree — a hub is larger (capped). The original's formula. */
export function nodeSizeFromDegree(degree: number): number {
	return 5 + Math.min(9, degree * 1.15);
}

/**
 * Compute the net force on each node from all-pairs repulsion + per-edge springs — ONE simulation
 * step's forces (not yet integrated). Ported from the vault-seed `computeForces`: repulsion is
 * O(n²) with a `+0.25` softening so co-located nodes don't blow up; springs pull toward a rest
 * length of `source.size + target.size + edgeIdealGap`. Returns a force vector per node, in the
 * same order as `nodes`. PURE — no mutation of the inputs.
 */
export function computeForces(
	nodes: readonly LayoutNode[],
	links: readonly GraphLink[],
	options: ComputeForcesOptions = {},
): Array<{ x: number; y: number }> {
	const repulsionForce = options.repulsionForce ?? LAYOUT_DEFAULTS.repulsionForce;
	const springForce = options.springForce ?? LAYOUT_DEFAULTS.springForce;
	const edgeIdealGap = options.edgeIdealGap ?? LAYOUT_DEFAULTS.edgeIdealGap;
	const repulsionMode = options.repulsionMode ?? "explorer";

	const forces = nodes.map(() => ({ x: 0, y: 0 }));
	const indexById = new Map<string, number>();
	nodes.forEach((node, index) => indexById.set(node.id, index));

	// All-pairs repulsion (equal and opposite).
	for (let i = 0; i < nodes.length; i += 1) {
		const source = nodes[i]!;
		for (let j = i + 1; j < nodes.length; j += 1) {
			const target = nodes[j]!;
			const dx = source.x - target.x;
			const dy = source.y - target.y;
			const distSq = dx * dx + dy * dy + 0.25;
			const dist = Math.sqrt(distSq);
			const denominator = repulsionMode === "hero" ? distSq : distSq * Math.max(1, dist);
			const repulsion = repulsionForce / denominator;
			const forceX = (dx / dist) * repulsion;
			const forceY = (dy / dist) * repulsion;
			forces[i]!.x += forceX;
			forces[i]!.y += forceY;
			forces[j]!.x -= forceX;
			forces[j]!.y -= forceY;
		}
	}

	// Per-edge spring toward the rest length.
	for (const link of links) {
		const si = indexById.get(link.source);
		const ti = indexById.get(link.target);
		if (si === undefined || ti === undefined) continue; // dangling edge → ignored
		const source = nodes[si]!;
		const target = nodes[ti]!;
		const dx = target.x - source.x;
		const dy = target.y - source.y;
		const distSq = dx * dx + dy * dy + 0.01;
		const dist = Math.sqrt(distSq);
		const ideal = source.size + target.size + edgeIdealGap;
		const pull = (dist - ideal) * springForce;
		const fx = (dx / dist) * pull;
		const fy = (dy / dist) * pull;
		forces[si]!.x += fx;
		forces[si]!.y += fy;
		forces[ti]!.x -= fx;
		forces[ti]!.y -= fy;
	}

	return forces;
}

/** Keep a node inside the viewport (minus its radius + a 2px margin) — the original's constrain. */
function constrain(node: LayoutNode): void {
	const min = node.size + 2;
	const max = VIEWBOX_SIZE - node.size - 2;
	node.x = clamp(node.x, min, max);
	node.y = clamp(node.y, min, max);
}

/** A deterministic per-id seed (the original's id-hash), so a layout is reproducible — no
 * Math.random, which also makes the seeding unit-testable and stable across runs/machines. */
function idSeed(id: string): number {
	let acc = 1;
	for (const char of id) acc = (acc * 131 + char.codePointAt(0)!) % 100000;
	return acc;
}

export interface GraphInput {
	nodes: ReadonlyArray<{ id: string; degree?: number }>;
	links: readonly GraphLink[];
}

/**
 * Seed initial node positions on a golden-angle spiral (so a fresh graph starts spread out, not
 * piled at the origin), jittered deterministically by an id-hash. Nodes are ordered by degree
 * descending (hubs first) — the original's ordering, which also drives which nodes show first in
 * an expand/collapse view. Returns fresh LayoutNodes; the input is untouched. Deterministic.
 */
export function seedLayout(graph: GraphInput): LayoutNode[] {
	const center = VIEWBOX_SIZE / 2;
	const radius = VIEWBOX_SIZE / 4;
	const ordered = [...graph.nodes]
		.map((n) => ({ id: n.id, degree: n.degree ?? 0 }))
		.sort((a, b) => b.degree - a.degree);
	return ordered.map((node, index) => {
		const goldenAngle = ordered.length > 0 ? index * 0.61803398875 : 0;
		const angle = ordered.length > 1 ? Math.PI * 2 * (goldenAngle % 1) - Math.PI / 2 : 0;
		const seed = idSeed(node.id);
		return {
			id: node.id,
			degree: node.degree,
			size: nodeSizeFromDegree(node.degree),
			x: center + Math.cos(angle) * radius + (((seed % 100) - 50) / 100) * 1.6,
			y: center + Math.sin(angle) * radius + ((((seed * 11) % 100) - 50) / 100) * 1.6,
			vx: ((seed % 20) - 10) / 1000,
			vy: (((seed * 3) % 20) - 10) / 1000,
		};
	});
}

export interface RelaxOptions extends ComputeForcesOptions {
	/** How many integration steps to run (default 80 — the original's initial layout). */
	steps?: number;
	centerForce?: number;
	damping?: number;
	maxNodeVelocity?: number;
}

/**
 * Run the simulation for N steps, MUTATING the nodes' positions/velocities in place (the caller
 * owns the array — seed it with `seedLayout` first). Each step: compute forces, add a gentle pull
 * toward the viewport center, integrate with damping + a velocity cap, and constrain into the box.
 * Ported from the vault-seed `runInitialLayout` integration. Deterministic given the seed.
 */
export function relaxLayout(nodes: LayoutNode[], links: readonly GraphLink[], options: RelaxOptions = {}): void {
	if (nodes.length < 2) return;
	const steps = options.steps ?? LAYOUT_DEFAULTS.forceSteps;
	const centerForce = options.centerForce ?? LAYOUT_DEFAULTS.centerForce;
	const damping = options.damping ?? LAYOUT_DEFAULTS.damping;
	const maxVel = options.maxNodeVelocity ?? LAYOUT_DEFAULTS.maxNodeVelocity;

	for (let step = 0; step < steps; step += 1) {
		const forces = computeForces(nodes, links, options);
		for (let i = 0; i < nodes.length; i += 1) {
			const node = nodes[i]!;
			const dx = VIEWBOX_SIZE / 2 - node.x;
			const dy = VIEWBOX_SIZE / 2 - node.y;
			node.vx = clamp((node.vx + forces[i]!.x + dx * centerForce) * damping, -maxVel, maxVel);
			node.vy = clamp((node.vy + forces[i]!.y + dy * centerForce) * damping, -maxVel, maxVel);
			node.x += node.vx;
			node.y += node.vy;
			constrain(node);
		}
	}
}

/**
 * The one-call convenience: seed a graph and relax it to a settled layout, returning the placed
 * nodes. This is the headless "give me coordinates for this {nodes,links}" entry a render layer
 * (or a test, or an export-to-image) uses. Deterministic — same graph in, same layout out.
 */
export function layoutGraph(graph: GraphInput, options: RelaxOptions = {}): LayoutNode[] {
	const nodes = seedLayout(graph);
	relaxLayout(nodes, graph.links, options);
	return nodes;
}
