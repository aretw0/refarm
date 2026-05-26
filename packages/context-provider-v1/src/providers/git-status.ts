import { affectedWorkspacePackagesFromGitStatus } from "@refarm.dev/config";
import { execFile } from "node:child_process";
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
	return affectedWorkspacePackagesFromGitStatus(cwd, status);
}

function formatAffectedWorkspaces(workspaces: string[]): string {
	return [
		"Changed workspace candidates:",
		...workspaces.map((workspace) => `- ${workspace}`),
		"",
		"Preferred aggregate validation command:",
		"- refarm agent finish --profile affected --run --json",
		"- refarm agent finish --profile affected --since upstream --run --json",
		"",
		"Package validation commands:",
		...workspaces.map(
			(workspace) =>
				`- refarm agent finish --profile package --workspace ${workspace} --run --json`,
		),
	].join("\n");
}
