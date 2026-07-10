import * as readline from "node:readline";

import type {
	CapabilityEnvelope,
	CapabilityInput,
	CapabilityRegistry,
	SurfaceItem,
} from "@refarm.dev/capabilities";
import { tuiSurfaceModel } from "@refarm.dev/capabilities";
import chalk from "chalk";

/**
 * The interactive TUI runtime — the terminal surface a capability projects onto
 * when a human drives it by keyboard rather than by a one-shot CLI command.
 *
 * It consumes the SAME neutral projection every surface reads,
 * `tuiSurfaceModel(registry)` (sections → items, each carrying its `renderers.tui`
 * hint), renders it as a navigable menu, reads a selection, invokes the verb's
 * `run()`, and renders the returned envelope. Declare a verb once → it appears in
 * the CLI, the web panel, AND here, with zero per-verb code.
 *
 * `node:readline` (native — no external TUI dependency) keeps this a thin,
 * dependency-light surface, matching how the rest of the repo does terminal
 * prompting (ask/chat/session-launch).
 */

/** How the runtime reads a line and writes output — injectable so it is testable. */
export interface TuiIo {
	/** Prompt the user and resolve with the entered line (without trailing newline). */
	prompt(question: string): Promise<string>;
	/** Write a line of output. */
	write(line: string): void;
	/** Close any held resources (e.g. the readline interface). */
	close(): void;
}

/** Options for {@link runTui}. */
export interface RunTuiOptions {
	/** Injected IO (defaults to a `node:readline` interface over stdin/stdout). */
	io?: TuiIo;
	/** Header shown once at the top (defaults to a generic title). */
	title?: string;
	/**
	 * Invoke a verb by name with a resolved input. Defaults to looking the verb up
	 * in the registry and calling its `run()`. Injectable so a host can route the
	 * call elsewhere (e.g. through a sidecar) without changing the loop.
	 */
	invoke?: (verb: string, input: CapabilityInput) => Promise<CapabilityEnvelope>;
}

/** A flat, selection-ordered view of the model: every item with its 1-based index. */
interface NumberedItem {
	index: number;
	section: string;
	item: SurfaceItem;
}

/** Build the default `node:readline`-backed IO over stdin/stdout. */
export function createReadlineTuiIo(): TuiIo {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return {
		prompt: (question) =>
			new Promise<string>((resolve) => rl.question(question, (answer) => resolve(answer))),
		write: (line) => process.stdout.write(`${line}\n`),
		close: () => rl.close(),
	};
}

/** Flatten the surface model into a numbered, selection-ordered list. */
function numberItems(registry: CapabilityRegistry): NumberedItem[] {
	const model = tuiSurfaceModel(registry);
	const numbered: NumberedItem[] = [];
	let index = 0;
	for (const section of model.sections) {
		for (const item of section.items) {
			index += 1;
			numbered.push({ index, section: section.section, item });
		}
	}
	return numbered;
}

/** The `renderers.tui` shortcut for an item, if it declared one. */
function shortcutOf(item: SurfaceItem): string | undefined {
	const tui = item.surfaces.tui;
	const shortcut = tui && typeof tui === "object" ? (tui as { shortcut?: unknown }).shortcut : undefined;
	return typeof shortcut === "string" && shortcut.length > 0 ? shortcut : undefined;
}

/** Render the menu (sections as headings, items as numbered rows). */
function renderMenu(numbered: NumberedItem[], write: (line: string) => void): void {
	let currentSection: string | null = null;
	for (const { index, section, item } of numbered) {
		if (section !== currentSection) {
			currentSection = section;
			write("");
			write(chalk.bold.cyan(section));
		}
		const shortcut = shortcutOf(item);
		const hint = shortcut ? chalk.dim(` (${shortcut})`) : "";
		write(`  ${chalk.yellow(String(index).padStart(2))}  ${item.name}${hint}  ${chalk.dim(item.summary)}`);
	}
	write("");
	write(chalk.dim("  Enter a number, a verb name, or 'q' to quit."));
}

/**
 * Resolve a raw selection line to the chosen item, or null. Accepts a 1-based
 * index, an exact verb name, or a declared `renderers.tui` shortcut.
 */
function resolveSelection(line: string, numbered: NumberedItem[]): NumberedItem | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	const asNumber = Number(trimmed);
	if (Number.isInteger(asNumber)) {
		return numbered.find((n) => n.index === asNumber) ?? null;
	}
	const lower = trimmed.toLowerCase();
	return (
		numbered.find((n) => n.item.name.toLowerCase() === lower) ??
		numbered.find((n) => shortcutOf(n.item)?.toLowerCase() === lower) ??
		null
	);
}

/** Render an envelope as terminal lines (ok/error + any human message it carries). */
function renderEnvelope(envelope: CapabilityEnvelope, write: (line: string) => void): void {
	if (envelope.ok) {
		const message = (envelope as { message?: unknown }).message;
		write(chalk.green("  ✓ ok") + (typeof message === "string" ? ` ${message}` : ""));
	} else {
		const e = envelope as { error?: string; message?: string };
		write(chalk.red(`  ✗ ${e.message ?? e.error ?? "error"}`));
	}
	for (const next of envelope.nextCommands ?? []) {
		write(chalk.dim(`    → ${next}`));
	}
}

/** Default invoker: look the verb up in the registry and call its `run()`. */
function registryInvoke(
	registry: CapabilityRegistry,
): (verb: string, input: CapabilityInput) => Promise<CapabilityEnvelope> {
	return async (verb, input) => {
		const entry = registry.get(verb);
		if (!entry || !("run" in entry)) {
			return {
				ok: false,
				error: "unknown-verb",
				message: `No runnable verb named "${verb}".`,
				nextAction: "list",
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			};
		}
		return entry.run(input);
	};
}

/**
 * Run the interactive TUI over a registry. Renders the menu, reads selections,
 * invokes verbs, and renders their envelopes until the user quits. Resolves when
 * the loop ends (a normal exit).
 */
export async function runTui(registry: CapabilityRegistry, options: RunTuiOptions = {}): Promise<void> {
	const io = options.io ?? createReadlineTuiIo();
	const invoke = options.invoke ?? registryInvoke(registry);
	const title = options.title ?? "Capabilities";
	try {
		io.write(chalk.bold(title));
		for (;;) {
			const numbered = numberItems(registry);
			if (numbered.length === 0) {
				io.write(chalk.dim("  (no capabilities registered)"));
				return;
			}
			renderMenu(numbered, io.write);
			const line = await io.prompt("> ");
			const trimmed = line.trim().toLowerCase();
			if (trimmed === "q" || trimmed === "quit" || trimmed === "exit") return;
			const chosen = resolveSelection(line, numbered);
			if (!chosen) {
				io.write(chalk.red(`  Unknown selection: ${line.trim() || "(empty)"}`));
				continue;
			}
			const envelope = await invoke(chosen.item.name, { args: {}, options: {}, json: false });
			renderEnvelope(envelope, io.write);
		}
	} finally {
		io.close();
	}
}
