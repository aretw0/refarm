import { spawnSync } from "node:child_process";

export interface GitCommandResult {
	status: number;
	stdout: string;
	stderr: string;
}

export interface GitCommandOptions {
	cwd?: string;
}

export function runGitCommand(args: string[], options: GitCommandOptions = {}): GitCommandResult {
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

function readOrThrow(args: string[], options: GitCommandOptions): string {
	const result = runGitCommand(args, options);
	if (result.status !== 0) {
		const detail = result.stderr || result.stdout || `git ${args.join(" ")} failed`;
		throw new Error(detail.trim());
	}
	return result.stdout;
}

/**
 * Trimmed stdout — right for every git command whose output is a VALUE (`rev-parse`, `log -1`,
 * `config --get`), where surrounding whitespace is noise.
 *
 * WRONG for any command whose output is COLUMNAR. `git status --short` emits `XY <path>`, two
 * status characters then a space, and column 0 is a space for a file modified in the working
 * tree but not staged. Trimming that eats the column, `slice(3)` then eats the path's first
 * character, and the caller sees a path that matches no workspace. That is not hypothetical:
 * it made the agent-finish lane that runs AFTER SOURCE EDITS AND BEFORE COMMITTING blind to
 * every unstaged edit, while staged ones (status char at column 0) survived the trim and were
 * seen — so the gate validated the wrong half of the working tree. Use `readGitCommandRaw`
 * for columnar output.
 *
 * (The lane is named in the app that owns it, not here: this package is brand-free by ADR-087
 * phase 3, and `command-handoff.test.ts` enforces that against comments too. It caught this
 * doc naming the binary, which is the guard working.)
 */
export function readGitCommand(args: string[], options: GitCommandOptions = {}): string {
	return readOrThrow(args, options).trim();
}

/** Stdout exactly as git wrote it. For columnar output — see `readGitCommand`'s doc for the
 *  bug that comes from trimming it. */
export function readGitCommandRaw(args: string[], options: GitCommandOptions = {}): string {
	return readOrThrow(args, options);
}
