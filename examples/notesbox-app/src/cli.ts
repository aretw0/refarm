#!/usr/bin/env node
import type { CapabilityHost } from "@refarm.dev/capabilities-v1";
import { localRecordsStatePath } from "@refarm.dev/capabilities-v1/node";

import {
	buildNotesboxHost,
	type NotesboxHostOptions,
} from "./registry.js";

export {
	buildNotesboxBaseModel,
	buildNotesboxHost,
	createNotesboxRegistry,
	type NotesboxHostOptions,
} from "./registry.js";

export const NOTESBOX_STATE_PATH_ENV = "NOTESBOX_STATE_PATH";

export function defaultNotesboxStatePath(cwd = process.cwd()): string {
	return process.env[NOTESBOX_STATE_PATH_ENV] || localRecordsStatePath({
		appId: "notesbox",
		cwd,
		fileName: "requirements.manifest.json",
	});
}

/**
 * The `notesbox` CLI — a white-label host over refarm. It mounts the neutral refarm
 * verbs (source/records/vault) PLUS its own `requirements` verb from a single composed
 * registry. The only thing that makes this "notesbox" and not "refarm" is the program
 * name + the app's own injected deps and verb — the substrate is unchanged.
 */
export function buildProgram(
	options: NotesboxHostOptions = {},
): ReturnType<CapabilityHost["program"]> {
	const cliOptions: NotesboxHostOptions = {
		...options,
		statePath: options.statePath ?? defaultNotesboxStatePath(),
	};
	return buildNotesboxHost(cliOptions).program();
}

// Entry point: only parse argv when run as the CLI, not when imported by a test.
const isMain =
	process.argv[1] !== undefined &&
	(import.meta.url === `file://${process.argv[1]}` ||
		import.meta.url.endsWith("/cli.js"));

if (isMain) {
	buildProgram()
		.parseAsync(process.argv)
		.catch((error: unknown) => {
			console.error(error);
			process.exitCode = 1;
		});
}
