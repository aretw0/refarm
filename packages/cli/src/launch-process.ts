import { spawn } from "node:child_process";
import { splitCommandLine } from "./command-line.js";

export interface LaunchProcessSpec {
	packageManager?: string | null;
	command: string;
	args: string[];
	cwd?: string;
	display: string;
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

export function launchProcess(spec: LaunchProcessSpec): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(spec.command, spec.args, {
			cwd: spec.cwd ?? process.cwd(),
			stdio: "inherit",
			env: process.env,
		});

		child.once("error", (error) => {
			reject(error);
		});

		child.once("close", (code) => {
			resolve(code ?? 0);
		});
	});
}
