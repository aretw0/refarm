import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { shellCommand } from "./command-handoff.js";
import { splitCommandLine } from "./command-line.js";

export interface LaunchProcessSpec {
	packageManager?: string | null;
	command: string;
	args: string[];
	cwd?: string;
	display: string;
}

export interface LaunchProcessRunOptions {
	capture?: boolean;
	env?: NodeJS.ProcessEnv;
}

export interface LaunchProcessRunnerOptions extends LaunchProcessRunOptions {
	cwd?: string;
	display?: string;
	packageManager?: string | null;
}

export type LaunchProcessRunner = (
	command: string,
	args: string[],
	options?: LaunchProcessRunnerOptions,
) => Promise<void>;

export interface LaunchProcessRunResult {
	exitCode: number;
	stdout?: string;
	stderr?: string;
}

export interface DetachedLaunchProcessOptions {
	logPath?: string;
	env?: NodeJS.ProcessEnv;
}

export interface DetachedLaunchProcess {
	unref(): void;
}

export function createLaunchProcessSpec(
	commandDisplay: string,
	options: { cwd?: string } = {},
): LaunchProcessSpec {
	const parsed = splitLaunchCommand(commandDisplay);
	return {
		...parsed,
		...(options.cwd ? { cwd: options.cwd } : {}),
		display: commandDisplay,
	};
}

export function createLaunchProcessSpecFromRunner(
	command: string,
	args: string[],
	options: LaunchProcessRunnerOptions = {},
): LaunchProcessSpec {
	return {
		command,
		args,
		...(options.cwd ? { cwd: options.cwd } : {}),
		...(options.packageManager !== undefined
			? { packageManager: options.packageManager }
			: {}),
		display: options.display ?? shellCommand(command, args),
	};
}

export function splitLaunchCommand(command: string): {
	command: string;
	args: string[];
} {
	const parts = splitCommandLine(command, "launcher command");
	if (parts.length === 0) {
		throw new Error("Invalid launcher command.");
	}

	return {
		command: parts[0]!,
		args: parts.slice(1),
	};
}

export function runLaunchProcess(
	spec: LaunchProcessSpec,
	options: LaunchProcessRunOptions = {},
): Promise<LaunchProcessRunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(spec.command, spec.args, {
			cwd: spec.cwd ?? process.cwd(),
			stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
			env: options.env ?? process.env,
		});
		let stdout = "";
		let stderr = "";

		if (options.capture) {
			child.stdout?.setEncoding("utf-8");
			child.stderr?.setEncoding("utf-8");
			child.stdout?.on("data", (chunk: string) => {
				stdout += chunk;
			});
			child.stderr?.on("data", (chunk: string) => {
				stderr += chunk;
			});
		}

		child.once("error", (error) => {
			reject(error);
		});

		child.once("close", (code) => {
			resolve({
				exitCode: code ?? 0,
				...(options.capture ? { stdout, stderr } : {}),
			});
		});
	});
}

export async function launchProcess(spec: LaunchProcessSpec): Promise<number> {
	const result = await runLaunchProcess(spec);
	return result.exitCode;
}

export function createLaunchProcessRunner(
	runProcess: (
		spec: LaunchProcessSpec,
		options?: LaunchProcessRunOptions,
	) => Promise<LaunchProcessRunResult> = runLaunchProcess,
): LaunchProcessRunner {
	return async (command, args, options = {}) => {
		const spec = createLaunchProcessSpecFromRunner(command, args, options);
		const result = await runProcess(spec, options);
		if (result.exitCode !== 0) {
			throw new Error(`'${spec.display}' exited with code ${result.exitCode}`);
		}
	};
}

export function launchDetachedProcess(
	spec: LaunchProcessSpec,
	options: DetachedLaunchProcessOptions = {},
): DetachedLaunchProcess {
	const outputFd = options.logPath ? openLaunchProcessLog(options.logPath) : "ignore";
	try {
		const child = spawn(spec.command, spec.args, {
			cwd: spec.cwd ?? process.cwd(),
			detached: true,
			env: options.env ?? process.env,
			stdio: ["ignore", outputFd, outputFd],
		});
		child.unref();
		return child;
	} finally {
		if (typeof outputFd === "number") {
			fs.closeSync(outputFd);
		}
	}
}

function openLaunchProcessLog(logPath: string): number {
	fs.mkdirSync(path.dirname(logPath), { recursive: true });
	return fs.openSync(logPath, "a");
}
