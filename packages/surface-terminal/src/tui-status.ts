/**
 * Render an operator-status model (the `BaseSurfaceModel` shape from @refarm.dev/operator-state) as a
 * laid-out terminal PANEL: each status unit becomes a bordered stat-card (label + summary), its label
 * colored by SEVERITY (error→red, warn→yellow, ok→green), over a "Next:" footer of the recommended
 * commands. The status half of the same convergence the dashboard gave the verb surface — every app with
 * `operatorStatus` gets a rich status face, not just a text block.
 *
 * Accepts the model as DATA (a structural subset), so surface-terminal needs no dependency on
 * operator-state; colorizers are injected (default chalk) so it stays brand-neutral + testable in plain
 * text. Reuses the layout engine (computeTuiLayout + renderTuiLayout).
 */
import chalk from "chalk";

import { computeTuiLayout, type LayoutNode } from "./tui-layout.js";
import { renderTuiLayout } from "./tui-render.js";

type Colorize = (text: string) => string;
const identity: Colorize = (text) => text;

/** One status unit — a structural subset of operator-state's BaseSurfaceUnit. */
export interface StatusPanelUnit {
	label: string;
	summary: string;
	/** Drives the label color: error/critical→red, warn→yellow, ok/success/verified→green. */
	severity?: string;
	state?: string;
}

/** A structural subset of operator-state's BaseSurfaceModel — the panel's input as data. */
export interface StatusPanelModel {
	units: StatusPanelUnit[];
	nextCommands?: string[];
}

export interface StatusPanelColors {
	label?: Colorize;
	summary?: Colorize;
	next?: Colorize;
	/** Maps a unit's severity to a colorizer for its label (the status indicator). */
	severity?: (severity: string | undefined) => Colorize;
}

/** The chalk palette a face opts into — severity drives the label color, the status indicator. */
export const defaultStatusColors: StatusPanelColors = {
	label: (text) => chalk.bold(text),
	summary: (text) => chalk.dim(text),
	next: (text) => chalk.cyan(text),
	severity: (severity) => {
		switch ((severity ?? "").toLowerCase()) {
			case "error":
			case "critical":
			case "fail":
				return (text) => chalk.red(text);
			case "warn":
			case "warning":
				return (text) => chalk.yellow(text);
			case "ok":
			case "success":
			case "verified":
			case "ready":
				return (text) => chalk.green(text);
			default:
				return identity;
		}
	},
};

export interface RenderStatusPanelOptions {
	/** Terminal width in cells. */
	width: number;
	/** Fixed card width in cells (default 26). */
	cardWidth?: number;
	/** Gap in cells between cards (default 2). */
	gap?: number;
	/** Injected colorizers (default identity — plain text). */
	colors?: StatusPanelColors;
}

/** Map a status model to a flex layout: a wrapping row of bordered stat-cards over a "Next:" footer.
 * Pure — no layout math, no I/O. */
export function statusPanelToLayout(model: StatusPanelModel, opts: RenderStatusPanelOptions): LayoutNode {
	const cardWidth = opts.cardWidth ?? 26;
	const gap = opts.gap ?? 2;
	const label = opts.colors?.label ?? identity;
	const summary = opts.colors?.summary ?? identity;
	const next = opts.colors?.next ?? identity;
	const severity = opts.colors?.severity ?? (() => identity);

	const cards: LayoutNode = {
		direction: "row",
		wrap: true,
		gap,
		children: model.units.map((unit) => ({
			direction: "column",
			width: cardWidth,
			border: true,
			padding: 1,
			children: [
				// The label carries the status: severity color over the base label style.
				{ text: severity(unit.severity)(label(unit.label)) },
				{ text: summary(unit.summary) },
			],
		})),
	};

	const children: LayoutNode[] = [cards];
	const nextCommands = model.nextCommands ?? [];
	if (nextCommands.length > 0) {
		children.push({
			direction: "column",
			children: [{ text: next("Next:") }, ...nextCommands.map((command) => ({ text: next(`  → ${command}`) }))],
		});
	}

	return { direction: "column", gap: 1, children };
}

/** Render a status model as a laid-out ANSI panel: project → Yoga layout → ANSI grid. */
export async function renderStatusPanel(model: StatusPanelModel, opts: RenderStatusPanelOptions): Promise<string> {
	const layout = statusPanelToLayout(model, opts);
	const positioned = await computeTuiLayout(layout, { width: opts.width });
	return renderTuiLayout(positioned);
}
