/**
 * The payoff of the TUI layout engine: the SAME neutral surface model a web face reads
 * (`tuiSurfaceModel(registry)` → sections/items) rendered as a laid-out terminal DASHBOARD — a column
 * of sections, each a heading over a WRAPPING row of cards (name + summary). This is the multi-region
 * composition a flat line menu cannot express, and the concrete demand that justifies a flex engine:
 * declare a verb once → CLI command + web card + agent tool + this laid-out terminal grid.
 *
 * `surfaceModelToLayout` is the projection (model → LayoutNode); Yoga does the flex math
 * (`computeTuiLayout`); `renderTuiLayout` paints it. Colorizers are INJECTED (default identity) so the
 * mapping stays brand-neutral and unit-testable in plain text; `defaultDashboardColors` is the chalk
 * palette a face opts into.
 */
import type { SurfaceModel } from "@refarm.dev/capabilities";
import chalk from "chalk";

import { focusOrder, type FocusTarget } from "./tui-focus.js";
import type { TerminalInput } from "./tui-input.js";
import { runInteractiveLayout, runInteractiveTerminal } from "./tui-interactive.js";
import { computeTuiLayout, type LayoutNode } from "./tui-layout.js";
import { renderTuiLayout } from "./tui-render.js";

type Colorize = (text: string) => string;
const identity: Colorize = (text) => text;

/** Per-role colorizers for the dashboard (default identity → plain text). */
export interface SurfaceDashboardColors {
	heading?: Colorize;
	name?: Colorize;
	summary?: Colorize;
	/** The FOCUSED card's name in an interactive dashboard (default: chalk.inverse). */
	focused?: Colorize;
}

/** The chalk palette a face opts into for a rich dashboard — the layout stays neutral without it. */
export const defaultDashboardColors: SurfaceDashboardColors = {
	heading: (text) => chalk.bold.cyan(text),
	name: (text) => chalk.bold(text),
	summary: (text) => chalk.dim(text),
	focused: (text) => chalk.inverse(text),
};

export interface SurfaceDashboardOptions {
	/** Fixed card width in cells (default 24). */
	cardWidth?: number;
	/** Gap in cells between cards in a row (default 2). */
	gap?: number;
	/** Injected colorizers (default identity — plain text). */
	colors?: SurfaceDashboardColors;
	/** The currently-focused card id — its name renders with `colors.focused` (interactive dashboard). */
	focusedId?: string;
}

/** Map a neutral surface model to a flex card-grid LayoutNode: a column of sections, each a heading
 * over a wrapping row of cards. Pure — no layout math, no I/O. */
export function surfaceModelToLayout(model: SurfaceModel, opts: SurfaceDashboardOptions = {}): LayoutNode {
	const cardWidth = opts.cardWidth ?? 24;
	const gap = opts.gap ?? 2;
	const heading = opts.colors?.heading ?? identity;
	const name = opts.colors?.name ?? identity;
	const summary = opts.colors?.summary ?? identity;
	const focused = opts.colors?.focused ?? name;

	const sections: LayoutNode[] = model.sections.map((section) => ({
		direction: "column",
		children: [
			{ text: heading(section.section) },
			{
				direction: "row",
				wrap: true,
				gap,
				children: section.items.map((item) => ({
					direction: "column",
					width: cardWidth,
					padding: 1,
					border: true,
					// The card is a focus target (interactive dashboard); its name highlights when focused.
					id: item.name,
					focusable: true,
					children: [
						{ text: (item.name === opts.focusedId ? focused : name)(item.name) },
						{ text: summary(item.summary) },
					],
				})),
			},
		],
	}));

	return { direction: "column", gap: 1, children: sections };
}

export interface RenderCapabilityDashboardOptions extends SurfaceDashboardOptions {
	/** Terminal width in cells to lay the dashboard out within. */
	width: number;
}

/**
 * Render a surface model as a laid-out ANSI dashboard string: project the model to a flex tree, lay it
 * out with Yoga, paint the positioned boxes. The end-to-end "one model → a laid-out terminal face".
 */
export async function renderCapabilityDashboard(
	model: SurfaceModel,
	opts: RenderCapabilityDashboardOptions,
): Promise<string> {
	const layout = surfaceModelToLayout(model, opts);
	const positioned = await computeTuiLayout(layout, { width: opts.width });
	return renderTuiLayout(positioned);
}

export interface RunInteractiveDashboardOptions extends SurfaceDashboardOptions {
	/** Terminal width in cells. */
	width: number;
	/** Fires when Enter runs on the focused card — the verb name. Return false to exit the loop. */
	onSelect?: (verb: string) => void | boolean | Promise<void | boolean>;
	/** Headless drive (tests): inject a key source + frame sink. Omit for a real terminal (alt-screen). */
	input?: TerminalInput;
	output?: (frame: string) => void;
}

/**
 * Run the dashboard as an INTERACTIVE face: cards are focusable, arrows navigate, Enter fires
 * `onSelect` with the focused verb. Positions are stable across focus (only the highlight color
 * changes), so focus targets are computed once and each frame re-renders with the focused card
 * highlighted. With `input` provided it runs headless (testable); otherwise it drives the real
 * terminal (alt-screen). Returns the last-focused verb.
 */
export async function runInteractiveDashboard(
	model: SurfaceModel,
	opts: RunInteractiveDashboardOptions,
): Promise<string | null> {
	const width = opts.width;
	const dashOptions: SurfaceDashboardOptions = { cardWidth: opts.cardWidth, gap: opts.gap, colors: opts.colors };
	const targets: FocusTarget[] = focusOrder(await computeTuiLayout(surfaceModelToLayout(model, dashOptions), { width }));
	const render = async (focusedId: string | null): Promise<string> =>
		renderTuiLayout(
			await computeTuiLayout(surfaceModelToLayout(model, { ...dashOptions, focusedId: focusedId ?? undefined }), {
				width,
			}),
		);

	if (opts.input) {
		return runInteractiveLayout({
			targets,
			render,
			input: opts.input,
			...(opts.output ? { output: opts.output } : {}),
			...(opts.onSelect ? { onSelect: opts.onSelect } : {}),
		});
	}
	return runInteractiveTerminal({
		targets,
		render,
		...(opts.onSelect ? { onSelect: opts.onSelect } : {}),
	});
}
