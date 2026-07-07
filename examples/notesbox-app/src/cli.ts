#!/usr/bin/env node
import { Command } from "commander";

import { createNotesboxRegistry, notesboxCliCommands } from "./registry.js";

/**
 * The `notesbox` CLI — a white-label host over refarm. It mounts the neutral refarm
 * verbs (source/records/vault) PLUS its own `requirements` verb from a single composed
 * registry. The only thing that makes this "notesbox" and not "refarm" is the program
 * name + the app's own injected deps and verb — the substrate is unchanged.
 */
export function buildProgram(): Command {
	const program = new Command()
		.name("notesbox")
		.description("Notesbox — a white-label refarm host for a requirements note box")
		.version("0.0.0");

	const registry = createNotesboxRegistry();
	for (const command of notesboxCliCommands(registry)) {
		program.addCommand(command);
	}
	return program;
}

// Entry point: only parse argv when run as the CLI, not when imported by a test.
const isMain =
	process.argv[1] !== undefined &&
	(import.meta.url === `file://${process.argv[1]}` ||
		import.meta.url.endsWith("/cli.js") ||
		import.meta.url.endsWith("/cli.ts"));

if (isMain) {
	buildProgram()
		.parseAsync(process.argv)
		.catch((error: unknown) => {
			console.error(error);
			process.exitCode = 1;
		});
}
