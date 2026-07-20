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

import type { TuiThemeLike } from "./tui-dashboard.js";
import { focusOrder } from "./tui-focus.js";
import type { TerminalInput } from "./tui-input.js";
import { runInteractiveLayout, withInteractiveTerminal } from "./tui-interactive.js";
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
	/** The focused "Next:" command in the interactive panel (default: inverse of `next`). */
	focus?: Colorize;
	/** Maps a unit's severity to a colorizer for its label (the status indicator). */
	severity?: (severity: string | undefined) => Colorize;
}

/** The chalk palette a face opts into — severity drives the label color, the status indicator. */
export const defaultStatusColors: StatusPanelColors = {
	label: (text) => chalk.bold(text),
	summary: (text) => chalk.dim(text),
	next: (text) => chalk.cyan(text),
	focus: (text) => chalk.inverse(chalk.cyan(text)),
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

/**
 * Build status-panel colorizers from a projected DS theme (`projectThemeToTui` output) — the SAME token set
 * the dashboard themes from (`dashboardColorsFromTuiTheme`). `foreground`→label, `muted-foreground`→summary,
 * `primary`→next; SEVERITY maps to the theme's semantic status tokens (error→`error`, warn→`warning`,
 * ok→`success`), each falling back to the default red/yellow/green when a token is absent. So ONE declared
 * theme colors every TUI face consistently — the status half of the dashboard's token convergence.
 */
export function statusColorsFromTuiTheme(theme: TuiThemeLike): StatusPanelColors {
	const roleColor = (token: string, fallback: Colorize): Colorize => {
		const color = theme[token];
		return color ? (text) => chalk.ansi256(color.ansi256)(text) : fallback;
	};
	const defaultSeverity = defaultStatusColors.severity!;
	const next = roleColor("primary", defaultStatusColors.next!);
	return {
		label: roleColor("foreground", defaultStatusColors.label!),
		summary: roleColor("muted-foreground", defaultStatusColors.summary!),
		next,
		focus: (text) => chalk.inverse(next(text)),
		severity: (severity) => {
			switch ((severity ?? "").toLowerCase()) {
				case "error":
				case "critical":
				case "fail":
					return roleColor("error", defaultSeverity("error"));
				case "warn":
				case "warning":
					return roleColor("warning", defaultSeverity("warn"));
				case "ok":
				case "success":
				case "verified":
				case "ready":
					return roleColor("success", defaultSeverity("ok"));
				default:
					return defaultSeverity(severity);
			}
		},
	};
}

export interface RenderStatusPanelOptions {
	/** Terminal width in cells. */
	width: number;
	/** Fixed card width in cells (default 26). */
	cardWidth?: number;
	/** Gap in cells between cards (default 2). */
	gap?: number;
	/** Injected colorizers (default identity — plain text). */
	colors?: StatusPanelColors;
	/** The "Next:" command currently focused (interactive panel) — rendered with the `focus` colorizer. */
	focusedCommandId?: string;
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
	// Dedupe: a focusable command's id IS its string, so two identical "Next:" commands would collide —
	// both highlight, and focus can't advance past the first. A repeated recommendation is noise anyway.
	const nextCommands = [...new Set(model.nextCommands ?? [])];
	if (nextCommands.length > 0) {
		const focus = opts.colors?.focus ?? next;
		const focusedId = opts.focusedCommandId;
		children.push({
			direction: "column",
			children: [
				{ text: next("Next:") },
				// Each recommended command is a FOCUSABLE target (id = the command), so the interactive panel
				// navigates them and Enter runs the focused one. Harmless for the static render (id/focusable
				// are layout metadata renderTuiLayout ignores); the focused one gets the `focus` style.
				...nextCommands.map((command) => ({
					id: command,
					focusable: true,
					text: (command === focusedId ? focus : next)(`  → ${command}`),
				})),
			],
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

export interface RunInteractiveStatusPanelOptions extends RenderStatusPanelOptions {
	/** Key source (injectable — `scriptedInput` for tests, `createStdinInput` for a real terminal). */
	input: TerminalInput;
	/** Write a rendered frame (injectable; default stdout). */
	output?: (frame: string) => void;
	/** Fires when Enter is pressed on the focused "Next:" command. Return `false` to exit the loop. */
	onSelect?: (command: string) => void | boolean | Promise<void | boolean>;
}

/**
 * Run the status panel as an INTERACTIVE face: the "Next:" commands are focusable, arrows navigate them,
 * and Enter fires `onSelect` with the focused command — so an operator ACTS on the recommendation (runs the
 * next command) without retyping it. PURE given injected input + output, so it is unit-testable with
 * scripted keys. Returns the last-focused command id.
 */
export async function runInteractiveStatusPanel(
	model: StatusPanelModel,
	opts: RunInteractiveStatusPanelOptions,
): Promise<string | null> {
	const render = async (focusedId: string | null): Promise<string> => {
		const layout = statusPanelToLayout(model, {
			...opts,
			...(focusedId !== null ? { focusedCommandId: focusedId } : {}),
		});
		const positioned = await computeTuiLayout(layout, { width: opts.width });
		return renderTuiLayout(positioned);
	};
	const positioned = await computeTuiLayout(statusPanelToLayout(model, opts), { width: opts.width });
	const targets = focusOrder(positioned);
	return runInteractiveLayout({
		targets,
		render,
		input: opts.input,
		...(opts.output ? { output: opts.output } : {}),
		...(opts.onSelect ? { onSelect: opts.onSelect } : {}),
	});
}

export interface RunInteractiveStatusPanelTerminalOptions
	extends Omit<RunInteractiveStatusPanelOptions, "input" | "output"> {
	/** Write raw terminal bytes (injectable for tests; default = stdout). */
	write?: (bytes: string) => void;
}

/**
 * Run the interactive status panel against the real terminal: alt-screen + raw-mode stdin drive the loop,
 * always restoring on exit (incl. Ctrl-C). Node-only. Returns the last-focused command id.
 */
export async function runInteractiveStatusPanelTerminal(
	model: StatusPanelModel,
	opts: RunInteractiveStatusPanelTerminalOptions,
): Promise<string | null> {
	return withInteractiveTerminal(
		(input, output) => runInteractiveStatusPanel(model, { ...opts, input, output }),
		opts.write,
	);
}
