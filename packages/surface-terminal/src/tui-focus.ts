/**
 * The focus model for an interactive laid-out face: which box is focused, and how a key moves focus —
 * a PURE traversal over the PositionedNode tree the layout engine already produces (its x/y/w/h ARE the
 * hit-test + focus-order data, so this adds no geometry, only navigation). No I/O, no rendering.
 * Brand-neutral.
 */
import type { Key } from "./tui-input.js";
import type { PositionedNode } from "./tui-layout.js";

/** A focusable box: its id + absolute cell rect. */
export interface FocusTarget {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Collect the focusable boxes (a node with `focusable` AND an `id`) in reading order — top-to-bottom,
 * then left-to-right — the stable order tab/next navigation follows. */
export function focusOrder(root: PositionedNode): FocusTarget[] {
	const targets: FocusTarget[] = [];
	const walk = (node: PositionedNode): void => {
		if (node.focusable && typeof node.id === "string") {
			targets.push({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height });
		}
		for (const child of node.children) walk(child);
	};
	walk(root);
	targets.sort((a, b) => a.y - b.y || a.x - b.x);
	return targets;
}

/** The nearest target in a vertical direction (dir = 1 down, -1 up): smallest row delta, then nearest
 * column. Null if none lie that way. */
function nearestVertical(order: readonly FocusTarget[], from: FocusTarget, dir: 1 | -1): FocusTarget | null {
	const candidates = order.filter((target) => (dir > 0 ? target.y > from.y : target.y < from.y));
	if (candidates.length === 0) return null;
	return candidates.reduce((best, target) => {
		const dy = Math.abs(target.y - from.y);
		const bestDy = Math.abs(best.y - from.y);
		if (dy !== bestDy) return dy < bestDy ? target : best;
		return Math.abs(target.x - from.x) < Math.abs(best.x - from.x) ? target : best;
	});
}

/** The nearest target in a horizontal direction WITHIN the same row (same y): smallest column delta.
 * Null if none — arrow nav clamps at a row's edge (tab is the cross-row cycle). */
function nearestHorizontal(order: readonly FocusTarget[], from: FocusTarget, dir: 1 | -1): FocusTarget | null {
	const sameRow = order.filter((target) => target.y === from.y && (dir > 0 ? target.x > from.x : target.x < from.x));
	if (sameRow.length === 0) return null;
	return sameRow.reduce((best, target) => (Math.abs(target.x - from.x) < Math.abs(best.x - from.x) ? target : best));
}

/**
 * Move focus by a key: `tab` cycles in reading order (wrapping); the ARROWS are spatial — left/right
 * move within the row (clamping at its edge), up/down to the geometrically nearest box. Returns the new
 * focused id — unchanged for a non-navigating key, the first target when nothing is focused yet, or null
 * only when there are no targets.
 */
export function moveFocus(order: readonly FocusTarget[], currentId: string | null, key: Key): string | null {
	if (order.length === 0) return null;
	const index = order.findIndex((target) => target.id === currentId);
	if (index < 0) return order[0]!.id; // nothing focused yet → first target
	const current = order[index]!;
	switch (key.name) {
		case "tab":
			return order[(index + 1) % order.length]!.id; // reading-order cycle (wraps)
		case "right":
			return (nearestHorizontal(order, current, 1) ?? current).id; // within-row, clamps at the edge
		case "left":
			return (nearestHorizontal(order, current, -1) ?? current).id;
		case "down":
			return (nearestVertical(order, current, 1) ?? current).id;
		case "up":
			return (nearestVertical(order, current, -1) ?? current).id;
		default:
			return currentId;
	}
}
