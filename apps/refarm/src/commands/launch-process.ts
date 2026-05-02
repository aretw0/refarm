import { spawn } from "node:child_process";

export interface LaunchProcessSpec {
	command: string;
	args: string[];
	display: string;
}

export function splitLaunchCommand(command: string): {
	command: string;
	args: string[];
} {
	const parts = command.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) {
		throw new Error("Invalid launcher command.");
	}

	return {
		command: parts[0],
		args: parts.slice(1),
	};
}

export function launchProcess(spec: LaunchProcessSpec): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(spec.command, spec.args, {
			cwd: process.cwd(),
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
