import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ProcessHandoffSpec {
	packageManager?: string | null;
	command: string;
	args: string[];
	cwd?: string;
	display: string;
}

export interface ProcessHandoffRunOptions {
	capture?: boolean;
	env?: NodeJS.ProcessEnv;
}

export interface ProcessHandoffRunnerOptions extends ProcessHandoffRunOptions {
	cwd?: string;
	display?: string;
	packageManager?: string | null;
}

export type ProcessHandoffRunner = (
	command: string,
	args: string[],
	options?: ProcessHandoffRunnerOptions,
) => Promise<void>;

export interface ProcessHandoffRunResult {
	exitCode: number;
	stdout?: string;
	stderr?: string;
}

export interface DetachedProcessHandoffOptions {
	logPath?: string;
	env?: NodeJS.ProcessEnv;
	onError?: (error: NodeJS.ErrnoException) => void;
}

export interface DetachedProcessHandoff {
	unref(): void;
}

export function quoteProcessHandoffArg(value: string): string {
	return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export function createProcessHandoffDisplay(
	command: string,
	args: readonly string[] = [],
): string {
	return [command, ...args.map(quoteProcessHandoffArg)].join(" ");
}

export function createProcessHandoffSpec(
	commandDisplay: string,
	options: { cwd?: string } = {},
): ProcessHandoffSpec {
	const parsed = splitProcessHandoffCommand(commandDisplay);
	return {
		...parsed,
		...(options.cwd ? { cwd: options.cwd } : {}),
		display: commandDisplay,
	};
}

export function createProcessHandoffSpecFromRunner(
	command: string,
	args: string[],
	options: ProcessHandoffRunnerOptions = {},
): ProcessHandoffSpec {
	return {
		command,
		args,
		...(options.cwd ? { cwd: options.cwd } : {}),
		...(options.packageManager !== undefined
			? { packageManager: options.packageManager }
			: {}),
		display: options.display ?? createProcessHandoffDisplay(command, args),
	};
}

export function splitProcessHandoffCommand(command: string): {
	command: string;
	args: string[];
} {
	const parts = splitCommandLine(command, "process handoff command");
	if (parts.length === 0) {
		throw new Error("Invalid process handoff command.");
	}

	return {
		command: parts[0]!,
		args: parts.slice(1),
	};
}

export function runProcessHandoff(
	spec: ProcessHandoffSpec,
	options: ProcessHandoffRunOptions = {},
): Promise<ProcessHandoffRunResult> {
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

export function runProcessHandoffSync(
	spec: ProcessHandoffSpec,
	options: ProcessHandoffRunOptions = {},
): ProcessHandoffRunResult {
	const result = spawnSync(spec.command, spec.args, {
		cwd: spec.cwd ?? process.cwd(),
		encoding: "utf-8",
		env: options.env ?? process.env,
		stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
	});
	return {
		exitCode: result.status ?? (result.error ? 1 : 0),
		...(options.capture ? { stdout: result.stdout ?? "", stderr: result.stderr ?? "" } : {}),
	};
}

export async function executeProcessHandoff(
	spec: ProcessHandoffSpec,
): Promise<number> {
	const result = await runProcessHandoff(spec);
	return result.exitCode;
}

export function createProcessHandoffRunner(
	runProcess: (
		spec: ProcessHandoffSpec,
		options?: ProcessHandoffRunOptions,
	) => Promise<ProcessHandoffRunResult> = runProcessHandoff,
): ProcessHandoffRunner {
	return async (command, args, options = {}) => {
		const spec = createProcessHandoffSpecFromRunner(command, args, options);
		const result = await runProcess(spec, options);
		if (result.exitCode !== 0) {
			throw new Error(`'${spec.display}' exited with code ${result.exitCode}`);
		}
	};
}

export function startDetachedProcessHandoff(
	spec: ProcessHandoffSpec,
	options: DetachedProcessHandoffOptions = {},
): DetachedProcessHandoff {
	const outputFd = options.logPath ? openProcessHandoffLog(options.logPath) : "ignore";
	try {
		const child = spawn(spec.command, spec.args, {
			cwd: spec.cwd ?? process.cwd(),
			detached: true,
			env: options.env ?? process.env,
			stdio: ["ignore", outputFd, outputFd],
		});
		child.once("error", (error) => {
			options.onError?.(error as NodeJS.ErrnoException);
		});
		child.unref();
		return child;
	} finally {
		if (typeof outputFd === "number") {
			fs.closeSync(outputFd);
		}
	}
}

function openProcessHandoffLog(logPath: string): number {
	fs.mkdirSync(path.dirname(logPath), { recursive: true });
	return fs.openSync(logPath, "a");
}

function splitCommandLine(commandLine: string, label = "command line"): string[] {
	const words: string[] = [];
	let current = "";
	let quote: "'" | "\"" | null = null;
	let escaping = false;

	for (const char of commandLine.trim()) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}

		if (char === "\\") {
			escaping = true;
			continue;
		}

		if (quote) {
			if (char === quote) {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}

		if (char === "'" || char === "\"") {
			quote = char;
			continue;
		}

		if (/\s/.test(char)) {
			if (current) {
				words.push(current);
				current = "";
			}
			continue;
		}

		current += char;
	}

	if (escaping) current += "\\";
	if (quote) throw new Error(`Unterminated quote in ${label}.`);
	if (current) words.push(current);
	return words;
}
