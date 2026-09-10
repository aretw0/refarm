import fs from "node:fs";
import path from "node:path";

import {
	NODE_AUTOMATIONS_RELATIVE_PATH,
	PROJECT_AUTOMATIONS_RELATIVE_PATH,
	findProjectAutomationsPath,
	normalizeProjectAutomationsDocument,
} from "./project-automations.js";

/**
 * WHAT A TICK ACTUALLY READ — the half of a scheduled-work report that was missing.
 *
 * MEASURED 2026-08-27, and it is why this module exists: the first supervised clock installed on
 * the operator's node carried `WorkingDirectory=$HOME` while project automations resolve from the
 * working directory. It watched a file that does not exist and logged
 * `Result=success due=0 submitted=0` every sixty seconds. A report of all zeros is the SAME line
 * whether nothing was due, nothing was declared, or nothing was found — three facts with opposite
 * consequences, printed identically.
 *
 * THREE STATES, NOT TWO. The adapter's own loader returns `undefined` for an absent file AND for
 * a malformed one, so a corrupted automations document reads exactly like no document. This reads
 * the files itself rather than asking that loader, because a verdict that shares its subject's
 * blind spot cannot report it.
 */
export type ScheduledWorkSourceState = "present" | "absent" | "unreadable";

export interface ScheduledWorkSource {
	/** `node` is the machine's own automations; `project` is the tree the tick stood in. */
	readonly scope: "node" | "project";
	/** The file that was read, or would have been. `null` when no project tree was found at all. */
	readonly path: string | null;
	readonly state: ScheduledWorkSourceState;
	/** Automations the document declares, at any status. */
	readonly declared: number;
	/** How many of those are `active` — the only status the trigger will fire. */
	readonly active: number;
	/** Present only when the document could not be read, saying why. */
	readonly reason?: string;
}

function describeOne(scope: "node" | "project", filePath: string | null): ScheduledWorkSource {
	if (!filePath) {
		return { scope, path: null, state: "absent", declared: 0, active: 0 };
	}
	if (!fs.existsSync(filePath)) {
		return { scope, path: filePath, state: "absent", declared: 0, active: 0 };
	}
	try {
		const document = normalizeProjectAutomationsDocument(
			JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown,
		);
		const declared = document.automations.length;
		const active = document.automations.filter((item) => item.status === "active").length;
		return { scope, path: filePath, state: "present", declared, active };
	} catch (error) {
		return {
			scope,
			path: filePath,
			state: "unreadable",
			declared: 0,
			active: 0,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}

export interface ScheduledWorkSourceOptions {
	/** The node's base — where `.refarm/automations.json` lives. */
	readonly base: string;
	/** The tree the tick stands in — `.project/automations.json` is searched upward from here. */
	readonly cwd: string;
}

/**
 * The sources a tick with these options would read, in the order the runner merges them.
 *
 * PURE apart from the filesystem reads it exists to perform. Never throws: a source that cannot
 * be read is reported as `unreadable`, because a tick that dies while describing itself is worse
 * than one that reports honestly and does nothing.
 */
export function describeScheduledWorkSources(
	options: ScheduledWorkSourceOptions,
): ScheduledWorkSource[] {
	const nodePath = path.join(options.base, NODE_AUTOMATIONS_RELATIVE_PATH);
	// The project file is searched UPWARD from the working directory, so report the resolved hit
	// rather than a guess — and `null` when the walk found nothing, which is the honest answer to
	// "which project file did you read" when there was none.
	const projectPath = findProjectAutomationsPath(options.cwd) ?? null;
	return [describeOne("node", nodePath), describeOne("project", projectPath)];
}

/** PURE. A one-line summary a journal can carry, naming what was read. */
export function formatScheduledWorkSources(sources: readonly ScheduledWorkSource[]): string {
	return sources
		.map((source) => {
			const where = source.path ?? `no ${PROJECT_AUTOMATIONS_RELATIVE_PATH} found`;
			if (source.state === "absent") return `${source.scope}: none (${where})`;
			if (source.state === "unreadable") return `${source.scope}: UNREADABLE (${where})`;
			return `${source.scope}: ${source.declared} declared, ${source.active} active (${where})`;
		})
		.join("; ");
}
