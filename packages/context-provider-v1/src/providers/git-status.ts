import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { ContextEntry, ContextProvider, ContextRequest } from "../types.js";
import { CONTEXT_CAPABILITY } from "../types.js";

const execFileAsync = promisify(execFile);

export class GitStatusContextProvider implements ContextProvider {
	readonly name = "git_status";
	readonly capability = CONTEXT_CAPABILITY;

	async provide(request: ContextRequest): Promise<ContextEntry[]> {
		try {
			const rootResult = await execFileAsync(
				"git",
				["rev-parse", "--show-toplevel"],
				{ cwd: request.cwd },
			);
			const gitRoot = rootResult.stdout.trim() || request.cwd;
			const statusResult = await execFileAsync(
				"git",
				["status", "--short", "--untracked-files=all"],
				{ cwd: gitRoot },
			);
			const logResult = await execFileAsync("git", ["log", "--oneline", "-5"], {
				cwd: gitRoot,
			}).catch(() => ({ stdout: "" }));
			const content = [
				statusResult.stdout.trim() || "(no changes)",
				"",
				"Last 5 commits:",
				logResult.stdout.trim() || "(no commits)",
			].join("\n");
			const entries: ContextEntry[] = [{ label: "git_status", content, priority: 30 }];
			const affectedWorkspaces = affectedWorkspaceCandidates(
				gitRoot,
				statusResult.stdout,
			);
			if (affectedWorkspaces.length > 0) {
				entries.push({
					label: "affected_workspaces",
					content: formatAffectedWorkspaces(affectedWorkspaces),
					priority: 35,
				});
			}
			return entries;
		} catch {
			return [];
		}
	}
}

function affectedWorkspaceCandidates(cwd: string, status: string): string[] {
	const candidates = new Set<string>();
	for (const changedPath of changedFilePaths(status)) {
		const workspace = findPackageDir(cwd, changedPath);
		if (workspace && workspace !== ".") candidates.add(workspace);
	}
	return [...candidates].sort();
}

function changedFilePaths(status: string): string[] {
	return status
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.map((line) => {
			const rawPath = line.slice(3).trim();
			const renamedPath = rawPath.includes(" -> ")
				? rawPath.split(" -> ").at(-1)
				: rawPath;
			return unquoteGitPath(renamedPath ?? rawPath);
		})
		.filter(Boolean);
}

function unquoteGitPath(value: string): string {
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
		try {
			return JSON.parse(value) as string;
		} catch {
			return value.slice(1, -1);
		}
	}
	return value;
}

function findPackageDir(cwd: string, changedPath: string): string | null {
	const absolutePath = path.resolve(cwd, changedPath);
	let current = fs.existsSync(absolutePath) && fs.statSync(absolutePath).isDirectory()
		? absolutePath
		: path.dirname(absolutePath);
	const root = path.resolve(cwd);
	while (current.startsWith(root)) {
		if (fs.existsSync(path.join(current, "package.json"))) {
			return path.relative(root, current) || ".";
		}
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
}

function formatAffectedWorkspaces(workspaces: string[]): string {
	return [
		"Changed workspace candidates:",
		...workspaces.map((workspace) => `- ${workspace}`),
		"",
		"Package validation commands:",
		...workspaces.map(
			(workspace) =>
				`- refarm agent finish --profile package --workspace ${workspace} --run --json`,
		),
	].join("\n");
}
