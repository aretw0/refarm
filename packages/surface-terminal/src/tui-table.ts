/**
 * A laid-out terminal TABLE — the second high-use shape the layout engine unlocks (after the card
 * dashboard). A header row over data rows with COLUMN-ALIGNED cells: each column's width is the widest
 * of its header + cells (capped), so a records / requirements / vault listing lines up. Reuses the flex
 * engine (fixed-width cells in a row align the columns); colorizers injected (default identity) so it is
 * brand-neutral + testable in plain text.
 */
import stringWidth from "string-width";

import { computeTuiLayout, type LayoutNode } from "./tui-layout.js";
import { renderTuiLayout } from "./tui-render.js";

type Colorize = (text: string) => string;
const identity: Colorize = (text) => text;

/** One column: the row key it reads, its header label, and an optional fixed width (else auto). */
export interface TableColumn {
	key: string;
	header: string;
	width?: number;
}

/** A row as a key→value map; non-string values are stringified. */
export type TableRow = Record<string, unknown>;

export interface TableColors {
	header?: Colorize;
	separator?: Colorize;
	cell?: Colorize;
}

export interface RenderTableOptions {
	/** Terminal width in cells. */
	width: number;
	/** Gap in cells between columns (default 2). */
	gap?: number;
	/** Cap an auto-sized column's width (default 40). */
	maxColumnWidth?: number;
	/** Draw a ─── separator row under the header (default true). */
	separator?: boolean;
	/** Injected colorizers (default identity — plain text). */
	colors?: TableColors;
}

const cellText = (row: TableRow, key: string): string => {
	const value = row[key];
	return value === undefined || value === null ? "" : String(value);
};

/** Compute each column's width: its declared width, else the widest of header + cells, capped. */
function columnWidths(columns: TableColumn[], rows: TableRow[], maxColumnWidth: number): number[] {
	return columns.map((column) => {
		if (typeof column.width === "number") return column.width;
		const widest = Math.max(stringWidth(column.header), 0, ...rows.map((row) => stringWidth(cellText(row, column.key))));
		return Math.min(widest, maxColumnWidth);
	});
}

/** Map columns + rows to a flex layout: a column of rows, each a row of fixed-width cells. Pure. */
export function tableToLayout(columns: TableColumn[], rows: TableRow[], opts: RenderTableOptions): LayoutNode {
	const gap = opts.gap ?? 2;
	const header = opts.colors?.header ?? identity;
	const separatorColor = opts.colors?.separator ?? identity;
	const cell = opts.colors?.cell ?? identity;
	const widths = columnWidths(columns, rows, opts.maxColumnWidth ?? 40);

	const rowOf = (cells: LayoutNode[]): LayoutNode => ({ direction: "row", gap, children: cells });
	const textCell = (text: string, width: number, color: Colorize): LayoutNode => ({ width, text: color(text) });

	const children: LayoutNode[] = [
		rowOf(columns.map((column, index) => textCell(column.header, widths[index]!, header))),
	];
	if (opts.separator !== false) {
		children.push(rowOf(widths.map((width) => textCell("─".repeat(width), width, separatorColor))));
	}
	for (const row of rows) {
		children.push(rowOf(columns.map((column, index) => textCell(cellText(row, column.key), widths[index]!, cell))));
	}
	return { direction: "column", children };
}

/** Render columns + rows as a laid-out ANSI table: project → Yoga layout → ANSI grid. */
export async function renderTable(
	columns: TableColumn[],
	rows: TableRow[],
	opts: RenderTableOptions,
): Promise<string> {
	const layout = tableToLayout(columns, rows, opts);
	const positioned = await computeTuiLayout(layout, { width: opts.width });
	return renderTuiLayout(positioned);
}
