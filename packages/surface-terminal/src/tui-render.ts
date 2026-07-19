/**
 * Paint a laid-out tree (`computeTuiLayout` → PositionedNode) to an ANSI string grid — the bespoke
 * terminal-rendering half the flex engine cannot do. Yoga placed the boxes; this drops each text leaf's
 * content into its box at absolute cell coordinates, clipped to the box, and stitches the rows.
 *
 * ANSI-AWARE by VISIBLE width, no cell buffer: a leaf's text may already carry color (chalk), so a raw
 * `.length` would mis-place everything. Each row is assembled from position-sorted segments; the gap
 * before a segment is padded by the running VISIBLE cursor, so a colored run lands on the same column a
 * plain one would. Non-overlapping by construction (flex layouts don't overlap siblings). Brand-neutral.
 */
import type { PositionedNode } from "./tui-layout.js";

// ESC[…m sequences, built without a control char in the literal (no-control-regex).
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Visible width of a string in terminal cells: ANSI stripped, code points counted. */
function visibleWidth(text: string): number {
	return [...text.replace(ANSI_PATTERN, "")].length;
}

/** Truncate a line to `width` visible cells. If it already fits, it is returned verbatim (color kept);
 * otherwise it falls back to the plain (ANSI-stripped) prefix — styling past the cut is dropped. */
function truncateToWidth(text: string, width: number, measure: (t: string) => number): string {
	if (measure(text) <= width) return text;
	const plain = text.replace(ANSI_PATTERN, "");
	return [...plain].slice(0, Math.max(0, width)).join("");
}

export interface RenderTuiLayoutOptions {
	/** Override the visible-width measure (default strips ANSI + counts code points). */
	measureWidth?: (text: string) => number;
}

interface Segment {
	row: number;
	col: number;
	text: string;
}

/** Collect each text leaf's lines as positioned segments, clipped to the leaf's box (height in rows,
 * width in cells). Coordinates are rounded to the integer cell grid. */
function collect(node: PositionedNode, segments: Segment[], measure: (t: string) => number): void {
	if (typeof node.text === "string") {
		const rows = Math.max(0, Math.round(node.height));
		const width = Math.max(0, Math.round(node.width));
		const lines = node.text.split("\n").slice(0, rows);
		lines.forEach((line, index) => {
			segments.push({
				row: Math.round(node.y) + index,
				col: Math.round(node.x),
				text: truncateToWidth(line, width, measure),
			});
		});
	}
	for (const child of node.children) collect(child, segments, measure);
}

/**
 * Render a positioned tree to a multi-line ANSI string (one line per terminal row, `\n`-joined).
 * Rows carry no trailing padding — the caller decides how to place the block. PURE.
 */
export function renderTuiLayout(root: PositionedNode, opts: RenderTuiLayoutOptions = {}): string {
	const measure = opts.measureWidth ?? visibleWidth;
	const height = Math.max(0, Math.round(root.height));
	const segments: Segment[] = [];
	collect(root, segments, measure);

	const rows: string[] = [];
	for (let y = 0; y < height; y++) {
		const rowSegments = segments.filter((seg) => seg.row === y).sort((a, b) => a.col - b.col);
		let line = "";
		let cursor = 0; // visible columns emitted so far
		for (const seg of rowSegments) {
			if (seg.col < cursor) continue; // overlap guard — flex siblings never overlap, but be safe
			if (seg.col > cursor) {
				line += " ".repeat(seg.col - cursor);
				cursor = seg.col;
			}
			line += seg.text;
			cursor += measure(seg.text);
		}
		rows.push(line);
	}
	return rows.join("\n");
}
