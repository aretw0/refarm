import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import { runSourceV1Conformance } from "@refarm.dev/source-contract-v1";
import { createLocalSourceProvider } from "./index.js";

const pexec = promisify(execFile);

async function git(args: string[], cwd?: string): Promise<void> {
	await pexec("git", args, { cwd });
}

async function createRepo(): Promise<string> {
	const repo = await mkdtemp(path.join(os.tmpdir(), "source-local-"));
	await git(["init", repo]);
	await git(["-C", repo, "config", "user.email", "source-local@test.dev"]);
	await git(["-C", repo, "config", "user.name", "Source Local Test"]);
	await writeFile(path.join(repo, "README.md"), "# source local\n");
	await git(["-C", repo, "add", "."]);
	await git(["-C", repo, "commit", "-m", "init"]);
	return repo;
}

describe("source-local provider", () => {
	it("passes source:v1 conformance against an existing local path", async () => {
		const repo = await createRepo();
		const provider = createLocalSourceProvider();
		const result = await runSourceV1Conformance(provider, `local:${repo}`);
		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
	});

	it("reports dirty and untracked working-tree state explicitly", async () => {
		const repo = await createRepo();
		await writeFile(path.join(repo, "README.md"), "# changed\n");
		await writeFile(path.join(repo, "new-file.md"), "# untracked\n");

		const provider = createLocalSourceProvider();
		const status = await provider.status(repo);

		expect(status.materialized).toBe(true);
		expect(status.clean).toBe(false);
		expect(status.dirty).toBe(true);
		expect(status.untracked).toBe(true);
		expect(status.untrackedPaths).toEqual(["new-file.md"]);
		expect(typeof status.head).toBe("string");
	});

	it("resolves relative paths from the configured cwd", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "source-local-cwd-"));
		const provider = createLocalSourceProvider({ cwd: root });
		const location = await provider.resolve("local:repo");
		expect(location.path).toBe(path.join(root, "repo"));
	});
});
