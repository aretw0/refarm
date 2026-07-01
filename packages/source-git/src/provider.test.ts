import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

import { runSourceV1Conformance } from "@refarm.dev/source-contract-v1";
import { createGitSourceProvider } from "./index.js";

const pexec = promisify(execFile);

async function g(args: string[], cwd?: string): Promise<void> {
	await pexec("git", args, { cwd });
}

let sampleRepo: string;
let cacheRoot: string;

beforeAll(async () => {
	const tmp = await mkdtemp(path.join(os.tmpdir(), "source-git-"));
	sampleRepo = path.join(tmp, "sample");
	cacheRoot = path.join(tmp, "cache");
	await g(["init", sampleRepo]);
	await g(["-C", sampleRepo, "config", "user.email", "t@t.dev"]);
	await g(["-C", sampleRepo, "config", "user.name", "Test"]);
	await writeFile(path.join(sampleRepo, "README.md"), "# sample\n");
	await g(["-C", sampleRepo, "add", "."]);
	await g(["-C", sampleRepo, "commit", "-m", "init"]);
});

describe("source-git provider", () => {
	it("passes source:v1 conformance against a local git remote", async () => {
		const provider = createGitSourceProvider({ cacheRoot });
		const result = await runSourceV1Conformance(provider, sampleRepo);
		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
	});

	it("clones on first materialize and reuses on second", async () => {
		const provider = createGitSourceProvider({ cacheRoot });
		const first = await provider.materialize(sampleRepo, { staleSeconds: 300 });
		expect(["cloned", "reused"]).toContain(first.action);
		const second = await provider.materialize(sampleRepo, { staleSeconds: 300 });
		expect(second.action).toBe("reused");
		const status = await provider.status(sampleRepo);
		expect(status.materialized).toBe(true);
		expect(status.clean).toBe(true);
		expect(typeof status.head).toBe("string");
	});
});
