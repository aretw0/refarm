import {
	VIEWBOX_SIZE,
	layoutGraph,
	type GraphInput,
	type GraphLink,
	type LayoutNode,
	type RelaxOptions,
} from "./layout.js";

/**
 * The INTERACTIVE DOM renderer — mount a `{nodes, links}` graph into an element and get a live,
 * navigable SVG: pan, wheel-zoom (anchored on the cursor), node drag, hover-neighbor highlight,
 * and a node-click callback. Built on the SAME headless `layoutGraph` as the static SVG, so the
 * physics is shared; this only adds the browser interaction.
 *
 * Assimilated from the vault-seed graph interaction driver (its viewport-transform + pointer math
 * are ported faithfully), but framework-agnostic: it takes a mount element + a JS `{nodes,links}`
 * (not DOM-scraped Astro markup) and emits an `onNodeClick(id)` callback (not a temp-anchor SPA
 * hack). A host — an Astro island, a plain page, an app — calls `mountGraph` and owns navigation.
 *
 * DOM-only (needs a document); the pure layout/physics it stands on is tested without a browser.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const MIN_SCALE = 0.68;
const MAX_SCALE = 3.2;
const DRAG_THRESHOLD_PX = 3;

export interface MountGraphOptions extends RelaxOptions {
	/** Node id → display label. Default: the id. */
	labelFor?: (id: string) => string;
	/** Called when a node is clicked (not dragged) — the host navigates. */
	onNodeClick?: (id: string) => void;
	/** Draw labels under nodes (default true). */
	showLabels?: boolean;
}

/** The companion CSS for `mountGraph` — hover dim/highlight + cursors + the neutral --surveyor-*
 * tokens (light/dark aware). A host injects this once (a <style> tag) so the interactive graph
 * looks right without importing an external stylesheet. Mirrors renderGraphSvg's token palette. */
export function interactiveStyles(): string {
	return `
.surveyor-graph--interactive { --surveyor-accent: #4f9d69; --surveyor-bg: #ffffff; --surveyor-edge: #b9c7bd; --surveyor-label: #2b2f2c; --surveyor-label-halo: #ffffff; cursor: grab; touch-action: none; }
.surveyor-graph--interactive.is-panning { cursor: grabbing; }
@media (prefers-color-scheme: dark) {
  .surveyor-graph--interactive { --surveyor-accent: #95d5b2; --surveyor-bg: #111310; --surveyor-edge: #35433a; --surveyor-label: #edf0ec; --surveyor-label-halo: #111310; }
}
.surveyor-graph__edge { stroke: var(--surveyor-edge); stroke-width: 1; transition: opacity .12s; }
.surveyor-graph__node { fill: var(--surveyor-accent); stroke: var(--surveyor-accent); stroke-width: 1; cursor: pointer; }
.surveyor-graph__label { font: 6px/1 system-ui, sans-serif; fill: var(--surveyor-label); stroke: var(--surveyor-label-halo); stroke-width: .6; paint-order: stroke; pointer-events: none; }
.surveyor-graph__node-group.is-hovered .surveyor-graph__node { stroke-width: 2; }
.surveyor-graph[data-hover="1"] .is-dimmed { opacity: .28; }
`.trim();
}

export interface GraphHandle {
	/** The root SVG element (for the host to size/style). */
	svg: SVGSVGElement;
	/** Re-run the layout and repaint (e.g. after the data changed). */
	relayout(graph: GraphInput): void;
	/** Tear down: remove listeners and the SVG. */
	destroy(): void;
}

interface LiveNode extends LayoutNode {
	group: SVGGElement;
	circle: SVGCircleElement;
	label: SVGTextElement | null;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function el<K extends keyof SVGElementTagNameMap>(doc: Document, name: K): SVGElementTagNameMap[K] {
	return doc.createElementNS(SVG_NS, name);
}

/**
 * Mount an interactive graph into `mountEl`. Returns a handle to relayout/destroy. The mount
 * element is cleared first. The graph is laid out headlessly, then rendered + wired for pan/zoom/
 * drag/hover/click.
 */
export function mountGraph(mountEl: Element, graph: GraphInput, options: MountGraphOptions = {}): GraphHandle {
	const doc = mountEl.ownerDocument;
	const labelFor = options.labelFor ?? ((id: string): string => id);
	const showLabels = options.showLabels !== false;

	const svg = el(doc, "svg");
	svg.setAttribute("viewBox", `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`);
	svg.setAttribute("class", "surveyor-graph surveyor-graph--interactive");
	svg.style.touchAction = "none"; // we handle pan/pinch ourselves

	const viewport = el(doc, "g");
	viewport.setAttribute("class", "surveyor-graph__viewport");
	const edgesGroup = el(doc, "g");
	edgesGroup.setAttribute("class", "surveyor-graph__edges");
	const nodesGroup = el(doc, "g");
	nodesGroup.setAttribute("class", "surveyor-graph__nodes");
	viewport.append(edgesGroup, nodesGroup);
	svg.append(viewport);
	mountEl.replaceChildren(svg);

	const viewportState = { scale: 1, tx: 0, ty: 0 };
	let live: LiveNode[] = [];
	let edgeEls: Array<{ line: SVGLineElement; source: string; target: string }> = [];
	let nodeById = new Map<string, LiveNode>();
	const adjacency = new Map<string, Set<string>>();
	let hovered: LiveNode | null = null;
	const pointer = {
		kind: null as null | "pan" | "drag",
		id: -1,
		originX: 0,
		originY: 0,
		anchorX: 0,
		anchorY: 0,
		offsetX: 0,
		offsetY: 0,
		item: null as LiveNode | null,
		moved: false,
	};

	function applyTransform(): void {
		viewport.setAttribute(
			"transform",
			`translate(${viewportState.tx.toFixed(3)} ${viewportState.ty.toFixed(3)}) scale(${viewportState.scale.toFixed(3)})`,
		);
	}

	/** Screen (client) point → graph coordinates, inverting the SVG CTM and the viewport transform.
	 * `localX/localY` are the pre-viewport-transform SVG coords (used to keep a point fixed on zoom). */
	function toGraph(clientX: number, clientY: number): { x: number; y: number; localX: number; localY: number } | null {
		const ctm = svg.getScreenCTM?.();
		if (!ctm) return null;
		const point = svg.createSVGPoint();
		point.x = clientX;
		point.y = clientY;
		const local = point.matrixTransform(ctm.inverse());
		return {
			localX: local.x,
			localY: local.y,
			x: (local.x - viewportState.tx) / viewportState.scale,
			y: (local.y - viewportState.ty) / viewportState.scale,
		};
	}

	function paintPositions(): void {
		for (const node of live) {
			node.circle.setAttribute("cx", node.x.toFixed(2));
			node.circle.setAttribute("cy", node.y.toFixed(2));
			if (node.label) {
				node.label.setAttribute("x", node.x.toFixed(2));
				node.label.setAttribute("y", (node.y + node.size + 6).toFixed(2));
			}
		}
		for (const edge of edgeEls) {
			const s = nodeById.get(edge.source);
			const t = nodeById.get(edge.target);
			if (!s || !t) continue;
			edge.line.setAttribute("x1", s.x.toFixed(2));
			edge.line.setAttribute("y1", s.y.toFixed(2));
			edge.line.setAttribute("x2", t.x.toFixed(2));
			edge.line.setAttribute("y2", t.y.toFixed(2));
		}
	}

	function activateHover(node: LiveNode): void {
		hovered = node;
		const neighbors = adjacency.get(node.id) ?? new Set<string>();
		svg.setAttribute("data-hover", "1");
		for (const other of live) {
			const isSelf = other.id === node.id;
			const isNeighbor = neighbors.has(other.id);
			other.group.classList.toggle("is-hovered", isSelf);
			other.group.classList.toggle("is-neighbor", isNeighbor);
			other.group.classList.toggle("is-dimmed", !isSelf && !isNeighbor);
		}
		for (const edge of edgeEls) {
			const incident = edge.source === node.id || edge.target === node.id;
			edge.line.classList.toggle("is-connected", incident);
			edge.line.classList.toggle("is-dimmed", !incident);
		}
	}

	function deactivateHover(): void {
		hovered = null;
		svg.removeAttribute("data-hover");
		for (const other of live) other.group.classList.remove("is-hovered", "is-neighbor", "is-dimmed");
		for (const edge of edgeEls) edge.line.classList.remove("is-connected", "is-dimmed");
	}

	function onPointerDown(event: PointerEvent): void {
		if (pointer.kind) return;
		const targetGroup = (event.target as Element | null)?.closest?.("[data-node-id]") as SVGGElement | null;
		const graphPoint = toGraph(event.clientX, event.clientY);
		if (!graphPoint) return;
		pointer.id = event.pointerId;
		pointer.originX = event.clientX;
		pointer.originY = event.clientY;
		pointer.moved = false;
		if (targetGroup) {
			const node = nodeById.get(targetGroup.dataset.nodeId ?? "");
			if (node) {
				pointer.kind = "drag";
				pointer.item = node;
				pointer.offsetX = graphPoint.x - node.x;
				pointer.offsetY = graphPoint.y - node.y;
				activateHover(node);
			}
		}
		if (!pointer.kind) {
			pointer.kind = "pan";
			pointer.anchorX = graphPoint.x;
			pointer.anchorY = graphPoint.y;
		}
		svg.setPointerCapture?.(event.pointerId);
		event.preventDefault();
	}

	function onPointerMove(event: PointerEvent): void {
		if (pointer.id !== event.pointerId || !pointer.kind) return;
		const graphPoint = toGraph(event.clientX, event.clientY);
		if (!graphPoint) return;
		if (!pointer.moved && Math.hypot(event.clientX - pointer.originX, event.clientY - pointer.originY) > DRAG_THRESHOLD_PX) {
			pointer.moved = true;
		}
		if (pointer.kind === "pan") {
			viewportState.tx = graphPoint.localX - pointer.anchorX * viewportState.scale;
			viewportState.ty = graphPoint.localY - pointer.anchorY * viewportState.scale;
			applyTransform();
		} else if (pointer.kind === "drag" && pointer.item && pointer.moved) {
			pointer.item.x = graphPoint.x - pointer.offsetX;
			pointer.item.y = graphPoint.y - pointer.offsetY;
			paintPositions();
		}
	}

	function onPointerUp(event: PointerEvent): void {
		if (pointer.id !== event.pointerId || !pointer.kind) return;
		const wasDrag = pointer.kind === "drag";
		const item = pointer.item;
		const moved = pointer.moved;
		pointer.kind = null;
		pointer.item = null;
		pointer.id = -1;
		svg.releasePointerCapture?.(event.pointerId);
		if (wasDrag && item && !moved) {
			options.onNodeClick?.(item.id); // a click, not a drag → navigate
			deactivateHover();
		} else if (!wasDrag) {
			deactivateHover();
		}
	}

	function onWheel(event: WheelEvent): void {
		event.preventDefault();
		const before = toGraph(event.clientX, event.clientY);
		if (!before) return;
		const direction = event.deltaY < 0 ? 1.12 : 0.89;
		viewportState.scale = clamp(viewportState.scale * direction, MIN_SCALE, MAX_SCALE);
		// Keep the point under the cursor fixed.
		viewportState.tx = before.localX - before.x * viewportState.scale;
		viewportState.ty = before.localY - before.y * viewportState.scale;
		applyTransform();
	}

	function build(placed: LayoutNode[], links: readonly GraphLink[]): void {
		edgesGroup.replaceChildren();
		nodesGroup.replaceChildren();
		adjacency.clear();
		nodeById = new Map();
		edgeEls = [];

		live = placed.map((node) => {
			const group = el(doc, "g");
			group.setAttribute("class", "surveyor-graph__node-group");
			group.dataset.nodeId = node.id;
			const circle = el(doc, "circle");
			circle.setAttribute("class", "surveyor-graph__node");
			circle.setAttribute("r", node.size.toFixed(2));
			const title = el(doc, "title");
			title.textContent = labelFor(node.id);
			group.append(title, circle);
			let label: SVGTextElement | null = null;
			if (showLabels) {
				label = el(doc, "text");
				label.setAttribute("class", "surveyor-graph__label");
				label.setAttribute("text-anchor", "middle");
				label.textContent = labelFor(node.id);
				group.append(label);
			}
			nodesGroup.append(group);
			const liveNode: LiveNode = { ...node, group, circle, label };
			nodeById.set(node.id, liveNode);
			return liveNode;
		});

		for (const link of links) {
			if (!nodeById.has(link.source) || !nodeById.has(link.target)) continue;
			const line = el(doc, "line");
			line.setAttribute("class", "surveyor-graph__edge");
			edgesGroup.append(line);
			edgeEls.push({ line, source: link.source, target: link.target });
			if (!adjacency.has(link.source)) adjacency.set(link.source, new Set());
			if (!adjacency.has(link.target)) adjacency.set(link.target, new Set());
			adjacency.get(link.source)!.add(link.target);
			adjacency.get(link.target)!.add(link.source);
		}

		// Hover on a node group.
		for (const node of live) {
			node.group.addEventListener("pointerenter", () => {
				if (!pointer.kind) activateHover(node);
			});
			node.group.addEventListener("pointerleave", () => {
				if (!pointer.kind && hovered === node) deactivateHover();
			});
		}

		paintPositions();
	}

	function relayout(nextGraph: GraphInput): void {
		const placed = layoutGraph(nextGraph, options);
		build(placed, nextGraph.links);
	}

	svg.addEventListener("pointerdown", onPointerDown as EventListener);
	svg.addEventListener("pointermove", onPointerMove as EventListener);
	svg.addEventListener("pointerup", onPointerUp as EventListener);
	svg.addEventListener("pointercancel", onPointerUp as EventListener);
	svg.addEventListener("wheel", onWheel as EventListener, { passive: false });

	relayout(graph);
	applyTransform();

	return {
		svg,
		relayout,
		destroy(): void {
			svg.removeEventListener("pointerdown", onPointerDown as EventListener);
			svg.removeEventListener("pointermove", onPointerMove as EventListener);
			svg.removeEventListener("pointerup", onPointerUp as EventListener);
			svg.removeEventListener("pointercancel", onPointerUp as EventListener);
			svg.removeEventListener("wheel", onWheel as EventListener);
			svg.remove();
		},
	};
}
