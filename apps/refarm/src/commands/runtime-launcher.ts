import {
	launchDetachedProcess,
	type DetachedLaunchProcess,
	type LaunchProcessSpec,
} from "@refarm.dev/cli/launch-process";
import fs from "node:fs";
import path from "node:path";

export type LaunchRuntimeEngine = "rust" | "ts";

export interface RuntimeLaunchCommand {
	engine: LaunchRuntimeEngine;
	command: string;
	args: string[];
	display: string;
	source: "repo-script" | "path";
	logPath?: string;
}

export type RuntimeProcess = DetachedLaunchProcess;

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
			logPath: path.join(repoRoot, ".refarm", `${engine}-runtime-start.log`),
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
	const spec: LaunchProcessSpec = {
		command: command.command,
		args: command.args,
		display: command.display,
	};
	return launchDetachedProcess(spec, { logPath: command.logPath });
}

export function runtimeStartHelpLines(repoRoot: string): string[] {
	return [
		`Local TS start:   ${resolveRuntimeLaunchCommand(repoRoot, "ts").display}`,
		`Local Rust start: ${resolveRuntimeLaunchCommand(repoRoot, "rust").display}`,
	];
}
