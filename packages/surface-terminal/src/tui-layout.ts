/**
 * The TUI layout engine — the missing HALF of terminal composition. `projectThemeToTui` (@refarm.dev/ds)
 * owns the COLOR half (tokens → ANSI); this owns the SPACE half: a flex tree → positioned boxes.
 *
 * DIVISION OF LABOUR, mirroring the token pipeline (adopt the generic hard math; author only what is
 * genuinely unserved): Yoga — Meta's flexbox, the same engine Ink uses — owns the FLEX MATH; refarm
 * owns the two terminal-specific parts an engine cannot do: TEXT MEASUREMENT (a terminal cell is not a
 * pixel — `measureText` gives a leaf's width in CELLS + its line count) and, in the sibling
 * `renderTuiLayout`, the projection of positioned boxes to an ANSI grid. Brand-neutral by design
 * (LayoutNode / PositionedNode, no `refarm` names) so the primitive is white-label portable.
 */
import {
	Align,
	Direction,
	Edge,
	FlexDirection,
	Gutter,
	Justify,
	loadYoga,
	MeasureMode,
	type Node as YogaNode,
	Wrap,
	type Yoga,
} from "yoga-layout/load";

/** A flex box OR a text leaf — the surface-neutral input to the engine. A node either wraps `children`
 * (a box) or carries `text` (a measured leaf, which ignores `children`). Every size/spacing is in
 * terminal CELLS, not pixels. */
export interface LayoutNode {
	/** Main-axis direction of this box's children. Default (Yoga's) is "column". */
	direction?: "row" | "column";
	/** Fixed size in cells; omit for content/flex sizing. */
	width?: number;
	height?: number;
	/** flex-grow: the share of free main-axis space this box claims. */
	flex?: number;
	/** Uniform inner padding in cells (all edges). */
	padding?: number;
	/** Gap in cells between children (both axes). */
	gap?: number;
	/** Cross-axis alignment of children. */
	align?: "start" | "center" | "end" | "stretch";
	/** Main-axis distribution of children. */
	justify?: "start" | "center" | "end" | "between" | "around";
	/** Wrap children onto multiple lines when they overflow the main axis. */
	wrap?: boolean;
	/** A stable id — set on a node the interactive loop can focus + select. */
	id?: string;
	/** Whether the interactive loop may focus this node (a focus target also needs an `id`). */
	focusable?: boolean;
	/** A text leaf's content (sized via `measureText`); mutually exclusive with `children`. */
	text?: string;
	children?: LayoutNode[];
}

/** A laid-out node: ABSOLUTE cell coordinates + size, mirroring the input tree. `renderTuiLayout`
 * paints these boxes; `text` rides along so a leaf's content lands in its box. */
export interface PositionedNode {
	x: number;
	y: number;
	width: number;
	height: number;
	text?: string;
	/** Mirrors the LayoutNode's `id` — the handle the focus model reports. */
	id?: string;
	/** Mirrors the LayoutNode's `focusable` — whether the focus model includes this box. */
	focusable?: boolean;
	children: PositionedNode[];
}

/** Measure a text leaf in terminal cells: display width (widest line) + line count. The bespoke
 * terminal-metrics seam — swap in a wcwidth/grapheme measure for wide (CJK) or zero-width glyphs. */
export interface MeasureText {
	(text: string): { width: number; height: number };
}

export interface ComputeTuiLayoutOptions {
	/** Available width in cells — the terminal columns the tree lays out within. */
	width: number;
	/** Available height in cells; omit for content height. */
	height?: number;
	/** Override the default cell measurer (e.g. a wcwidth-aware one). */
	measureText?: MeasureText;
}

// ESC[…m color/style sequences, built without a control char in the literal (no-control-regex).
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Default cell measurer: strip ANSI, count code points per line; width = widest line, height = lines.
 * A reasonable FLOOR (not grapheme / east-asian-width aware) — the documented refinement seam. */
export const defaultMeasureText: MeasureText = (text) => {
	const lines = text.replace(ANSI_PATTERN, "").split("\n");
	const width = Math.max(0, ...lines.map((line) => [...line].length));
	return { width, height: lines.length };
};

const ALIGN: Record<NonNullable<LayoutNode["align"]>, Align> = {
	start: Align.FlexStart,
	center: Align.Center,
	end: Align.FlexEnd,
	stretch: Align.Stretch,
};

const JUSTIFY: Record<NonNullable<LayoutNode["justify"]>, Justify> = {
	start: Justify.FlexStart,
	center: Justify.Center,
	end: Justify.FlexEnd,
	between: Justify.SpaceBetween,
	around: Justify.SpaceAround,
};

let yogaPromise: Promise<Yoga> | undefined;
/** Load Yoga's WASM once (async init) and reuse it — the module-level engine handle. */
function engine(): Promise<Yoga> {
	return (yogaPromise ??= loadYoga());
}

/** Build a Yoga node tree from a LayoutNode spec, attaching a measure function to each text leaf. */
function build(yoga: Yoga, spec: LayoutNode, measureText: MeasureText): YogaNode {
	const node = yoga.Node.create();
	if (spec.direction === "row") node.setFlexDirection(FlexDirection.Row);
	else if (spec.direction === "column") node.setFlexDirection(FlexDirection.Column);
	if (typeof spec.width === "number") node.setWidth(spec.width);
	if (typeof spec.height === "number") node.setHeight(spec.height);
	if (typeof spec.flex === "number") node.setFlexGrow(spec.flex);
	if (typeof spec.padding === "number") node.setPadding(Edge.All, spec.padding);
	if (typeof spec.gap === "number") node.setGap(Gutter.All, spec.gap);
	if (spec.align) node.setAlignItems(ALIGN[spec.align]);
	if (spec.justify) node.setJustifyContent(JUSTIFY[spec.justify]);
	if (spec.wrap) node.setFlexWrap(Wrap.Wrap);
	if (typeof spec.text === "string") {
		const text = spec.text;
		node.setMeasureFunc((availableWidth, widthMode) => {
			const measured = measureText(text);
			let width = measured.width;
			if (widthMode === MeasureMode.Exactly) width = availableWidth;
			else if (widthMode === MeasureMode.AtMost) width = Math.min(measured.width, availableWidth);
			return { width, height: measured.height };
		});
	} else if (spec.children) {
		spec.children.forEach((child, index) => node.insertChild(build(yoga, child, measureText), index));
	}
	return node;
}

/** Read a laid-out Yoga tree into PositionedNodes with ABSOLUTE cell coordinates (Yoga reports each
 * position relative to its parent, so offsets accumulate down the tree). */
function read(node: YogaNode, spec: LayoutNode, offsetX: number, offsetY: number): PositionedNode {
	const layout = node.getComputedLayout();
	const x = offsetX + layout.left;
	const y = offsetY + layout.top;
	const children: PositionedNode[] = [];
	const count = node.getChildCount();
	for (let index = 0; index < count; index++) {
		const childSpec = spec.children?.[index] ?? {};
		children.push(read(node.getChild(index), childSpec, x, y));
	}
	const positioned: PositionedNode = { x, y, width: layout.width, height: layout.height, children };
	if (spec.text !== undefined) positioned.text = spec.text;
	if (spec.id !== undefined) positioned.id = spec.id;
	if (spec.focusable !== undefined) positioned.focusable = spec.focusable;
	return positioned;
}

/**
 * Lay out a flex tree into positioned boxes (absolute cell coordinates) within the available width.
 * Yoga owns the flex math; the caller owns text measurement (`opts.measureText`). Async because Yoga's
 * WASM initializes once, lazily; the engine is cached across calls. PURE given the measure function.
 */
export async function computeTuiLayout(
	root: LayoutNode,
	opts: ComputeTuiLayoutOptions,
): Promise<PositionedNode> {
	const yoga = await engine();
	const measureText = opts.measureText ?? defaultMeasureText;
	const tree = build(yoga, root, measureText);
	// The root spans the available width unless it declares its own — the terminal is its containing block.
	if (typeof root.width !== "number") tree.setWidth(opts.width);
	tree.calculateLayout(opts.width, opts.height ?? undefined, Direction.LTR);
	const positioned = read(tree, root, 0, 0);
	tree.freeRecursive(); // release the WASM nodes; positions are already copied out
	return positioned;
}
