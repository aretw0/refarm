import {
	dispatchCapability,
	type CapabilityRegistry,
} from "@refarm.dev/capabilities";
import { parseChatLine } from "@refarm.dev/cli/chat-repl";
import readline from "node:readline";

import { surfaceModel } from "@refarm.dev/capabilities";

/** How a surface's REPL reaches the agent for a free-text message. Injected: a host wires
 * its runtime (the sidecar prompt sink); absent → the REPL reports the agent is not
 * connected, so the verb/command half still works without a daemon. Neutral across
 * surfaces — the TUI here; the web consumes the same surfaceModel through homestead. */
export type SendPrompt = (text: string) => Promise<string>;

/**
 * The live TUI — a terminal surface over the neutral {@link surfaceModel}, sharing the
 * SAME base as every other surface so they stay coherent. It prints the model as a
 * sectioned menu and runs a REPL over the SAME grammar (parseChatLine): `/verb …`
 * dispatches the verb, `/help` lists them, free text goes to the agent via an injected
 * sendPrompt. One command engine across CLI, TUI, and (via homestead) web — the
 * multi-surface invariant.
 */

export interface TuiOptions {
	title?: string;
	subtitle?: string;
	/** How the REPL sends free text to the agent. Absent → an honest "not connected"
	 * (the verb/command half still works). */
	sendPrompt?: SendPrompt;
}

/** Render the surface model as a terminal menu — pure string, unit-testable without a
 * TTY. Each section lists its verbs (name — summary [shortcut]). */
export function renderTuiMenu(registry: CapabilityRegistry): string {
	const model = surfaceModel(registry);
	if (model.sections.length === 0) {
		return "No verb declares a surface yet. Add renderers.tui/web to a verb.";
	}
	const lines: string[] = [];
	for (const section of model.sections) {
		lines.push(section.section.toUpperCase());
		for (const item of section.items) {
			const key = item.surfaces.tui?.shortcut;
			const shortcut = typeof key === "string" ? `  [${key}]` : "";
			lines.push(`  /${item.name} — ${item.summary}${shortcut}`);
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

/** The result of handling one REPL line — what the caller prints. `close` signals the
 * loop should end (an `/exit`). Pure over the registry + sendPrompt, so a test drives a
 * line without a TTY. */
export interface TuiLineResult {
	output: string;
	close?: boolean;
}

/** Handle one REPL line the SAME way the web /repl endpoint does — the shared engine.
 * Exposed so both the interactive loop and tests dispatch through one path. */
export async function handleTuiLine(
	line: string,
	registry: CapabilityRegistry,
	capabilityNames: ReadonlySet<string>,
	sendPrompt?: SendPrompt,
): Promise<TuiLineResult> {
	const command = parseChatLine(line, capabilityNames);

	if (command.kind === "exit") return { output: "Goodbye.", close: true };

	if (command.kind === "help") {
		return { output: renderTuiMenu(registry) };
	}

	if (command.kind === "message") {
		if (!command.text) return { output: "" };
		if (!sendPrompt) {
			return { output: "(agent not connected — inject sendPrompt to enable)" };
		}
		try {
			return { output: await sendPrompt(command.text) };
		} catch (e) {
			return { output: `agent error: ${String(e)}` };
		}
	}

	if (command.kind === "capability") {
		const entry = registry.list().find((e) => e.name.toLowerCase() === command.name);
		if (!entry) return { output: `unknown verb: ${command.name}` };
		try {
			// One shared dispatch: resolve (a flat verb's argv is parsed too — it used to run with empty
			// input), validate against the derived schema, then run. Render the outcome as text.
			const outcome = await dispatchCapability(entry, command.argv);
			if (outcome.status === "unresolved") return { output: `could not resolve ${command.name}` };
			if (outcome.status === "invalid") {
				const detail = outcome.validation?.errors
					.map((e) => (e.field ? `${e.field} ${e.message}` : e.message))
					.join("; ");
				return { output: `invalid input: ${detail ?? "invalid"}` };
			}
			return { output: JSON.stringify(outcome.envelope, null, 2) };
		} catch (e) {
			return { output: `verb error: ${String(e)}` };
		}
	}

	return { output: `(${command.kind} is not handled on this TUI surface yet)` };
}

/**
 * Run the interactive TUI loop over stdin/stdout. Prints the menu, then reads lines and
 * dispatches each via {@link handleTuiLine}. Resolves when the user exits. The pure
 * pieces (renderTuiMenu, handleTuiLine) carry the logic; this is the thin readline shell.
 */
export function runTui(registry: CapabilityRegistry, options: TuiOptions = {}): Promise<void> {
	const capabilityNames = new Set(registry.list().map((e) => e.name.toLowerCase()));
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: "> ",
	});

	if (options.title) process.stdout.write(`${options.title}\n`);
	if (options.subtitle) process.stdout.write(`${options.subtitle}\n`);
	process.stdout.write(`${renderTuiMenu(registry)}\n\n`);
	process.stdout.write("Type /help for commands, or free text for the agent.\n\n");
	rl.prompt();

	return new Promise<void>((resolve) => {
		rl.on("line", (line) => {
			void handleTuiLine(line, registry, capabilityNames, options.sendPrompt).then((res) => {
				if (res.output) process.stdout.write(`${res.output}\n`);
				if (res.close) {
					rl.close();
					return;
				}
				rl.prompt();
			});
		});
		rl.on("close", () => resolve());
	});
}
