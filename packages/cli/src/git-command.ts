import { spawnSync } from "node:child_process";

export interface GitCommandResult {
	status: number;
	stdout: string;
	stderr: string;
}

export interface GitCommandOptions {
	cwd?: string;
}

export function runGitCommand(
	args: string[],
	options: GitCommandOptions = {},
): GitCommandResult {
	const result = spawnSync("git", args, {
		...(options.cwd ? { cwd: options.cwd } : {}),
		encoding: "utf8",
	});
	return {
		status: result.status ?? (result.error ? 1 : 0),
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

export function readGitCommand(
	args: string[],
	options: GitCommandOptions = {},
): string {
	const result = runGitCommand(args, options);
	if (result.status !== 0) {
		const detail =
			result.stderr || result.stdout || `git ${args.join(" ")} failed`;
		throw new Error(detail.trim());
	}
	return result.stdout.trim();
}
