import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ContextEntry, ContextProvider, ContextRequest } from "../types.js";
import { CONTEXT_CAPABILITY } from "../types.js";

const execFileAsync = promisify(execFile);

const KNOWN_POLICY_FILES = [
	"AGENTS.md",
	"CLAUDE.md",
	".cursorrules",
	".github/copilot-instructions.md",
] as const;

export interface PolicyFile {
	relativePath: string;
	absolutePath: string;
	lines: number;
	sizeKb: number;
	heading: string | null;
}

export class PolicyFilesContextProvider implements ContextProvider {
	readonly name = "policy_files";
	readonly capability = CONTEXT_CAPABILITY;

	async provide(request: ContextRequest): Promise<ContextEntry[]> {
		try {
			const rootResult = await execFileAsync(
				"git",
				["rev-parse", "--show-toplevel"],
				{ cwd: request.cwd },
			);
			const gitRoot = rootResult.stdout.trim();
			const found = PolicyFilesContextProvider.scanPolicyFiles(gitRoot);
			if (found.length === 0) return [];
			return [PolicyFilesContextProvider.buildEntry(found)];
		} catch {
			return [];
		}
	}

	static scanPolicyFiles(gitRoot: string): PolicyFile[] {
		const found: PolicyFile[] = [];
		for (const rel of KNOWN_POLICY_FILES) {
			const abs = join(gitRoot, rel);
			try {
				const content = readFileSync(abs, "utf8");
				const lines = content.split("\n").length;
				const sizeKb = Math.round(content.length / 1024);
				const heading = content.match(/^#\s+(.+)/m)?.[1] ?? null;
				found.push({ relativePath: rel, absolutePath: abs, lines, sizeKb, heading });
			} catch {
				// file not present — skip
			}
		}
		return found;
	}

	static buildEntry(files: PolicyFile[]): ContextEntry {
		const lines = [
			"Policy files in this workspace (read with agent-fs.read before making code changes):",
			...files.map((f) => {
				const desc = f.heading ? `"${f.heading}"` : f.relativePath;
				return `- ${f.absolutePath}  (${f.lines} lines, ~${f.sizeKb}KB) — ${desc}`;
			}),
		];
		return { label: "policy_files", content: lines.join("\n"), priority: 12 };
	}
}
