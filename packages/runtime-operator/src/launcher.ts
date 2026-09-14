import { sovereignDir } from "@refarm.dev/config";
import {
	startDetachedProcessHandoff,
	type DetachedProcessHandoff,
	type ProcessHandoffSpec,
} from "@refarm.dev/process-handoff";
import fs from "node:fs";
import path from "node:path";

/**
 * Resolve and start the runtime daemon for ANY refarm-based app — the launcher half of
 * the runtime operator. It picks how to start the daemon (a repo start-script if
 * present, else the binary on PATH) per engine, and spawns it detached via the
 * tokenized process-handoff. It knows nothing about which app is launching it, so
 * `refarm`, `dgk`, or any white-label host reuses the same, observable launch path.
 */

export type LaunchRuntimeEngine = "rust" | "ts";

export interface RuntimeLaunchCommand {
	engine: LaunchRuntimeEngine;
	command: string;
	args: string[];
	display: string;
	source: "repo-script" | "path";
	logPath?: string;
}

export type RuntimeProcess = DetachedProcessHandoff;

const RUNTIME_STARTERS: Record<
	LaunchRuntimeEngine,
	{
		binary: string;
		binaryArgs: string[];
		script: string;
		scriptArgs: string[];
	}
> = {
	rust: {
		binary: "tractor",
		binaryArgs: [],
		script: "tractor-start.sh",
		scriptArgs: ["--background"],
	},
	ts: {
		binary: "farmhand",
		binaryArgs: ["--background"],
		script: "farmhand-start.sh",
		scriptArgs: ["--background"],
	},
};

export function resolveRuntimeLaunchCommand(
	repoRoot: string,
	engine: LaunchRuntimeEngine,
	/**
	 * The arguments the NODE needs, for the PATH fallback.
	 *
	 * MEASURED 2026-08-19: with the CLI installed rather than run from the working tree, the
	 * fallback launched a bare `tractor` — no `--plugin`, no `--refarm-dir` — because its
	 * `binaryArgs` are a constant. A runtime started that way is not the operator's node; it is a
	 * different one wearing the same name, which is worse than refusing to start.
	 *
	 * TAKEN, not derived. Which plugins boot and where the sovereign directory is are facts about
	 * the node, and ADR-059 already assigns their discovery to the CLI. A package reaching for
	 * them would be a second answer to a question that already has one.
	 *
	 * IGNORED for the repo script, which derives its own and takes trailing arguments: handing it
	 * an independently-derived set is how two sources of truth begin to disagree.
	 */
	nodeArgs?: readonly string[],
): RuntimeLaunchCommand {
	const starter = RUNTIME_STARTERS[engine];
	const scriptPath = path.join(repoRoot, "scripts", starter.script);
	if (fs.existsSync(scriptPath)) {
		return {
			engine,
			command: "bash",
			args: [scriptPath, ...starter.scriptArgs],
			display: ["bash", path.join("scripts", starter.script), ...starter.scriptArgs].join(" "),
			source: "repo-script",
			logPath: path.join(repoRoot, sovereignDir(), `${engine}-runtime-start.log`),
		};
	}
	// APPENDED, never substituted. The starter's own arguments are how an engine daemonises —
	// `farmhand --background` — and node arguments describe WHICH node, not HOW to run. Replacing
	// them produced `farmhand --refarm-dir …` with no `--background`, caught by the suite.
	const args = [...starter.binaryArgs, ...(nodeArgs ?? [])];
	return {
		engine,
		command: starter.binary,
		args,
		display: [starter.binary, ...args].join(" "),
		source: "path",
	};
}

export function startRuntimeProcess(
	command: RuntimeLaunchCommand,
	/**
	 * The environment the runtime is handed. Defaults to this process's.
	 *
	 * MEASURED 2026-08-19: an installed node started its runtime through the PATH fallback and the
	 * runtime came up healthy and REFUSED every dispatch — "declared provider 'github-copilot',
	 * which this node did not authorise". The repo script does more than assemble arguments: it
	 * evaluates `refarm model env --include-secrets` before exec, so the host inherits the node's
	 * authorisation and credentials. A launcher that carries only the arguments starts a runtime
	 * that serves and cannot work.
	 *
	 * TAKEN, not derived, for the same reason `nodeArgs` is: which providers a node authorises is
	 * its own fact, and this package must not learn to read it.
	 */
	env?: NodeJS.ProcessEnv,
): RuntimeProcess {
	const spec: ProcessHandoffSpec = {
		command: command.command,
		args: command.args,
		display: command.display,
	};
	return startDetachedProcessHandoff(spec, { logPath: command.logPath, ...(env ? { env } : {}) });
}

export function runtimeStartHelpLines(repoRoot: string): string[] {
	return [
		`Local TS start:   ${resolveRuntimeLaunchCommand(repoRoot, "ts").display}`,
		`Local Rust start: ${resolveRuntimeLaunchCommand(repoRoot, "rust").display}`,
	];
}
