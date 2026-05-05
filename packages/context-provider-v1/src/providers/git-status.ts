import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CONTEXT_CAPABILITY } from "../types.js";
import type { ContextEntry, ContextProvider, ContextRequest } from "../types.js";

const execFileAsync = promisify(execFile);

export class GitStatusContextProvider implements ContextProvider {
	readonly name = "git_status";
	readonly capability = CONTEXT_CAPABILITY;

	async provide(request: ContextRequest): Promise<ContextEntry[]> {
		try {
			const [statusResult, logResult] = await Promise.all([
				execFileAsync("git", ["status", "--short"], { cwd: request.cwd }),
				execFileAsync("git", ["log", "--oneline", "-5"], {
					cwd: request.cwd,
				}),
			]);
			const content = [
				statusResult.stdout.trim() || "(no changes)",
				"",
				"Last 5 commits:",
				logResult.stdout.trim() || "(no commits)",
			].join("\n");
			return [{ label: "git_status", content, priority: 30 }];
		} catch {
			return [];
		}
	}
}
