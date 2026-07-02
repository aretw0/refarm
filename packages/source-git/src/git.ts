import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export async function git(args: string[], cwd?: string): Promise<string> {
	const { stdout } = await pexec("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
	return stdout.trim();
}

export async function partialClone(remote: string, dest: string, filter: string): Promise<void> {
	const args = ["clone"];
	if (filter !== "none") args.push(`--filter=${filter}`);
	args.push(remote, dest);
	await git(args);
}

export async function headCommit(repo: string): Promise<string> {
	return git(["rev-parse", "HEAD"], repo);
}

export async function isClean(repo: string): Promise<boolean> {
	const out = await git(["status", "--porcelain"], repo);
	return out.length === 0;
}

export async function hasUpstream(repo: string): Promise<boolean> {
	try {
		await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], repo);
		return true;
	} catch {
		return false;
	}
}

export async function fetchAndMaybeFastForward(
	repo: string,
): Promise<"fetched" | "fast-forwarded"> {
	await git(["fetch", "origin"], repo);
	if ((await isClean(repo)) && (await hasUpstream(repo))) {
		await git(["merge", "--ff-only", "@{u}"], repo);
		return "fast-forwarded";
	}
	return "fetched";
}
