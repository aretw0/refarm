import { VIEWBOX_SIZE, layoutGraph, type GraphInput, type GraphLink, type LayoutNode } from "./layout.js";

/**
 * The thin SVG RENDER layer — turn a laid-out graph into a self-contained, theme-aware SVG
 * STRING. Pure (no DOM): a browser can inject the string, a build step can write it to a file (a
 * diagram for a doc/screenshot), a test can assert on it. This is the static/export face of the
 * graph; an interactive DOM renderer (pan/zoom/drag) can layer on the same layout + this markup.
 *
 * Assimilated from the vault-seed graph SVG shape (viewBox 200, edges then nodes, circle radius =
 * node size, label below the node), reskinned with HOST-NEUTRAL CSS custom properties (no
 * Starlight `--sl-*` tokens) so it embeds anywhere and themes light/dark via `prefers-color-scheme`.
 */

export interface RenderGraphSvgOptions {
	/** Draw a label under each node (default true). */
	showLabels?: boolean;
	/** Map a node id to its display label. Default: the id. */
	labelFor?: (id: string) => string;
	/** Map a node id to a click target (an href on a wrapping <a>). Default: none (no links). */
	hrefFor?: (id: string) => string | undefined;
	/** Max label characters before truncation (default 18). */
	maxLabelChars?: number;
	/** A title for the <title> element (accessibility). */
	title?: string;
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function truncate(label: string, max: number): string {
	return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/** The self-contained style block: neutral custom properties + a light/dark default. A host can
 * override `--surveyor-*` to reskin without touching the markup. */
function styleBlock(): string {
	return `<style>
    .surveyor-graph { --surveyor-accent: #4f9d69; --surveyor-bg: #ffffff; --surveyor-edge: #b9c7bd; --surveyor-label: #2b2f2c; --surveyor-label-halo: #ffffff; }
    @media (prefers-color-scheme: dark) {
      .surveyor-graph { --surveyor-accent: #95d5b2; --surveyor-bg: #111310; --surveyor-edge: #35433a; --surveyor-label: #edf0ec; --surveyor-label-halo: #111310; }
    }
    .surveyor-graph__edge { stroke: var(--surveyor-edge); stroke-width: 1; }
    .surveyor-graph__node { stroke: var(--surveyor-accent); stroke-width: 1; }
    .surveyor-graph__label { font: 6px/1 system-ui, sans-serif; fill: var(--surveyor-label); stroke: var(--surveyor-label-halo); stroke-width: 0.6; paint-order: stroke; }
  </style>`;
}

/** The fill for a node, deepening with degree (a hub reads darker/stronger). */
function nodeFill(node: LayoutNode): string {
	const weight = Math.max(24, Math.min(86, Math.round(40 * (0.72 + Math.min(1, node.degree / 8) * 0.6))));
	return `color-mix(in srgb, var(--surveyor-accent) ${weight}%, var(--surveyor-bg))`;
}

/**
 * Render already-placed nodes + links to an SVG string. Use this when you already ran the layout
 * (e.g. to animate). For a one-call "graph → SVG", use `graphToSvg`.
 */
export function renderGraphSvg(
	nodes: readonly LayoutNode[],
	links: readonly GraphLink[],
	options: RenderGraphSvgOptions = {},
): string {
	const showLabels = options.showLabels !== false;
	const labelFor = options.labelFor ?? ((id: string): string => id);
	const maxChars = options.maxLabelChars ?? 18;
	const byId = new Map(nodes.map((n) => [n.id, n]));

	const edges = links
		.map((link) => {
			const s = byId.get(link.source);
			const t = byId.get(link.target);
			if (!s || !t) return "";
			return `<line class="surveyor-graph__edge" x1="${s.x.toFixed(2)}" y1="${s.y.toFixed(2)}" x2="${t.x.toFixed(2)}" y2="${t.y.toFixed(2)}" />`;
		})
		.filter(Boolean)
		.join("\n      ");

	const nodeMarkup = nodes
		.map((node) => {
			const label = truncate(labelFor(node.id), maxChars);
			const circle = `<circle class="surveyor-graph__node" cx="${node.x.toFixed(2)}" cy="${node.y.toFixed(2)}" r="${node.size.toFixed(2)}" style="fill: ${nodeFill(node)};" />`;
			const text = showLabels
				? `\n        <text class="surveyor-graph__label" x="${node.x.toFixed(2)}" y="${(node.y + node.size + 6).toFixed(2)}" text-anchor="middle">${escapeXml(label)}</text>`
				: "";
			const inner = `<title>${escapeXml(labelFor(node.id))}</title>\n        ${circle}${text}`;
			const href = options.hrefFor?.(node.id);
			return href
				? `<a href="${escapeXml(href)}">\n        ${inner}\n      </a>`
				: `<g>\n        ${inner}\n      </g>`;
		})
		.join("\n      ");

	const titleEl = options.title ? `<title>${escapeXml(options.title)}</title>` : "";
	return `<svg class="surveyor-graph" viewBox="0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}" role="img" xmlns="http://www.w3.org/2000/svg">
  ${titleEl}${styleBlock()}
  <g class="surveyor-graph__edges" aria-hidden="true">
      ${edges}
  </g>
  <g class="surveyor-graph__nodes">
      ${nodeMarkup}
  </g>
</svg>`;
}

/**
 * One call: lay out a `{nodes, links}` graph and render it to an SVG string. The headless
 * pipeline end to end — `graphFromRecords` (adapter) → this → an SVG a doc, screenshot, or web
 * page shows. Deterministic (same graph → same SVG).
 */
export function graphToSvg(graph: GraphInput, options: RenderGraphSvgOptions = {}): string {
	const placed = layoutGraph(graph);
	return renderGraphSvg(placed, graph.links, options);
}
