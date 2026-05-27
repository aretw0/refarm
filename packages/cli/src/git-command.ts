import { spawnSync } from "node:child_process";

export interface GitCommandResult {
	status: number;
	stdout: string;
	stderr: string;
}

export function runGitCommand(args: string[]): GitCommandResult {
	const result = spawnSync("git", args, {
		encoding: "utf8",
	});
	return {
		status: result.status ?? (result.error ? 1 : 0),
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

export function readGitCommand(args: string[]): string {
	const result = runGitCommand(args);
	if (result.status !== 0) {
		const detail =
			result.stderr || result.stdout || `git ${args.join(" ")} failed`;
		throw new Error(detail.trim());
	}
	return result.stdout.trim();
}
