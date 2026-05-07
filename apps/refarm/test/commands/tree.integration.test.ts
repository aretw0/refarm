import * as childProcess from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTreeCommand } from "../../src/commands/tree.js";

const originalCwd = process.cwd();
let tempDir: string | undefined;

function runGit(args: string[], cwd: string): string {
	const result = childProcess.spawnSync("git", args, {
		cwd,
		encoding: "utf8",
	});
	if (result.status !== 0) {
		throw new Error(
			result.stderr || result.stdout || `git ${args.join(" ")} failed`,
		);
	}
	return result.stdout.trim();
}

async function createIsolatedGitRepo(): Promise<string> {
	tempDir = await mkdtemp(path.join(tmpdir(), "refarm-tree-vitest-"));
	const gitRepoPath = path.join(tempDir, "repo");
	await mkdir(gitRepoPath, { recursive: true });
	runGit(["init", "--initial-branch=main"], gitRepoPath);
	await writeFile(
		path.join(gitRepoPath, "README.md"),
		"# tree integration\n",
		"utf8",
	);
	runGit(["add", "README.md"], gitRepoPath);
	runGit(
		[
			"-c",
			"user.name=Refarm Tree Test",
			"-c",
			"user.email=refarm-tree-test@example.invalid",
			"commit",
			"-m",
			"seed",
		],
		gitRepoPath,
	);
	return gitRepoPath;
}

describe("refarm tree git integration", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		if (tempDir) {
			await rm(tempDir, { recursive: true, force: true });
			tempDir = undefined;
		}
	});

	it("forks without switching, then explicitly switches an isolated git repo", async () => {
		const gitRepoPath = await createIsolatedGitRepo();
		process.chdir(gitRepoPath);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const command = createTreeCommand();

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: async () => ({
					sessions: [
						{
							"@id": "urn:refarm:session:v1:integration0001",
							"@type": "Session",
							name: "integration-session",
							created_at_ns: 1_700_000_000_000_000_000,
							leaf_entry_id: "entry-1",
						},
					],
				}),
			}) as any,
		);
		await command.commands
			.find((c) => c.name() === "list")!
			.parseAsync(["--scope", "all", "--limit", "2", "--json"], {
				from: "user",
			});
		const allPayload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
		expect(allPayload).toMatchObject({
			schemaVersion: 1,
			scope: "all",
			operation: "list",
		});
		expect(allPayload.nodes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "session" }),
				expect.objectContaining({ kind: "git" }),
			]),
		);

		await command.commands
			.find((c) => c.name() === "fork")!
			.parseAsync(
				["HEAD", "--scope", "git", "--name", "smoke/tree-fork", "--json"],
				{ from: "user" },
			);
		const forkPayload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
		expect(forkPayload).toMatchObject({
			schemaVersion: 1,
			scope: "git",
			operation: "fork",
			reason: "executed",
			result: {
				branchName: "smoke/tree-fork",
				worktreeSwitched: false,
				currentRefBefore: "main",
				currentRefAfter: "main",
			},
		});
		expect(runGit(["branch", "--show-current"], gitRepoPath)).toBe("main");
		expect(
			runGit(["branch", "--list", "smoke/tree-fork"], gitRepoPath),
		).toContain("smoke/tree-fork");

		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["smoke/tree-fork", "--scope", "git", "--switch", "--json"], {
				from: "user",
			});
		const previewPayload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
		expect(previewPayload).toMatchObject({
			schemaVersion: 1,
			scope: "git",
			operation: "preview",
			reason: "dry-run",
			plan: {
				action: "switch",
				readyToExecute: true,
				recommendedCommand: "refarm tree switch --scope git smoke/tree-fork",
				effects: {
					activePointerChanged: true,
					branchCreated: false,
				},
				substrate: {
					kind: "git-switch",
					worktreeClean: true,
					currentRefBefore: "main",
					targetRefAfter: "smoke/tree-fork",
					worktreeSwitched: true,
				},
			},
		});
		expect(runGit(["branch", "--show-current"], gitRepoPath)).toBe("main");

		await writeFile(
			path.join(gitRepoPath, "README.md"),
			"# dirty preview\n",
			"utf8",
		);
		await command.commands
			.find((c) => c.name() === "preview")!
			.parseAsync(["smoke/tree-fork", "--scope", "git", "--switch", "--json"], {
				from: "user",
			});
		const dirtyPreviewPayload = JSON.parse(
			logSpy.mock.calls.at(-1)?.[0] as string,
		);
		expect(dirtyPreviewPayload.plan).toMatchObject({
			action: "switch",
			readyToExecute: false,
			blockedReason: "Git worktree must be clean before tree switch execution.",
			substrate: {
				kind: "git-switch",
				worktreeClean: false,
				currentRefBefore: "main",
				targetRefAfter: "smoke/tree-fork",
			},
		});
		expect(runGit(["branch", "--show-current"], gitRepoPath)).toBe("main");
		runGit(["checkout", "--", "README.md"], gitRepoPath);

		await command.commands
			.find((c) => c.name() === "switch")!
			.parseAsync(["smoke/tree-fork", "--scope", "git", "--json"], {
				from: "user",
			});
		const switchPayload = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
		expect(switchPayload).toMatchObject({
			schemaVersion: 1,
			scope: "git",
			operation: "switch",
			reason: "executed",
			result: {
				branchName: "smoke/tree-fork",
				worktreeSwitched: true,
				currentRefBefore: "main",
				currentRefAfter: "smoke/tree-fork",
			},
		});
		expect(runGit(["branch", "--show-current"], gitRepoPath)).toBe(
			"smoke/tree-fork",
		);
	});
});
