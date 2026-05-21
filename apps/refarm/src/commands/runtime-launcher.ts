import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type LaunchRuntimeEngine = "rust" | "ts";

export interface RuntimeLaunchCommand {
	engine: LaunchRuntimeEngine;
	command: string;
	args: string[];
	display: string;
	source: "repo-script" | "path";
}

export interface RuntimeProcess {
	unref(): void;
}

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
): RuntimeLaunchCommand {
	const starter = RUNTIME_STARTERS[engine];
	const scriptPath = path.join(repoRoot, "scripts", starter.script);
	if (fs.existsSync(scriptPath)) {
		return {
			engine,
			command: "bash",
			args: [scriptPath, ...starter.scriptArgs],
			display: [
				"bash",
				path.join("scripts", starter.script),
				...starter.scriptArgs,
			].join(" "),
			source: "repo-script",
		};
	}
	return {
		engine,
		command: starter.binary,
		args: starter.binaryArgs,
		display: [starter.binary, ...starter.binaryArgs].join(" "),
		source: "path",
	};
}

export function startRuntimeProcess(command: RuntimeLaunchCommand): RuntimeProcess {
	const child = spawn(command.command, command.args, {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
	return child;
}

export function runtimeStartHelpLines(repoRoot: string): string[] {
	return [
		`Local TS start:   ${resolveRuntimeLaunchCommand(repoRoot, "ts").display}`,
		`Local Rust start: ${resolveRuntimeLaunchCommand(repoRoot, "rust").display}`,
	];
}
