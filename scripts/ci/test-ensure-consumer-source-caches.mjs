import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
	ensureConsumerSourceCaches,
	parseArgs,
} from "./ensure-consumer-source-caches.mjs";

const pexec = promisify(execFile);

async function git(args, cwd) {
	await pexec("git", args, { cwd });
}

async function createRepo(name) {
	const repo = mkdtempSync(path.join(os.tmpdir(), `${name}-`));
	writeFileSync(path.join(repo, "README.md"), `# ${name}\n`, "utf8");
	await git(["init", repo]);
	await git(["-C", repo, "config", "user.email", `${name}@test.dev`]);
	await git(["-C", repo, "config", "user.name", `${name} Test`]);
	await git(["-C", repo, "add", "."]);
	await git(["-C", repo, "commit", "-m", "init"]);
	return repo;
}

test("parseArgs keeps default targets and accepts cache options", () => {
	const options = parseArgs(["--json", "--offline", "--cache-root", "/tmp/cache", "--stale-seconds", "0"]);
	assert.equal(options.json, true);
	assert.equal(options.offline, true);
	assert.equal(options.cacheRoot, "/tmp/cache");
	assert.equal(options.staleSeconds, 0);
	const targetIds = options.targets.map((target) => target.id);
	assert.ok(targetIds.includes("agents-lab"));
	assert.ok(targetIds.includes("vault-seed"));
});

test("parseArgs uses the configured persistent cache root by default", () => {
	const options = parseArgs([]);
	assert.equal(options.cacheRoot, "/home/vscode/.cache/checkouts");
});

test("parseArgs accepts custom targets", () => {
	const options = parseArgs(["--target", "fixture=/tmp/repo=Fixture purpose"]);
	assert.deepEqual(options.targets, [
		{ id: "fixture", ref: "/tmp/repo", purpose: "Fixture purpose" },
	]);
});

test("ensureConsumerSourceCaches materializes and reuses source-git caches", async () => {
	const sourceRepo = await createRepo("consumer-source-cache");
	const cacheRoot = mkdtempSync(path.join(os.tmpdir(), "consumer-source-cache-root-"));
	const first = await ensureConsumerSourceCaches({
		cacheRoot,
		targets: [{ id: "fixture", ref: sourceRepo, purpose: "fixture repo" }],
		now: new Date("2026-07-03T00:00:00.000Z"),
	});

	assert.equal(first.ok, true);
	assert.equal(first.generatedAt, "2026-07-03T00:00:00.000Z");
	assert.equal(first.targets[0].ok, true);
	assert.equal(first.targets[0].hadCache, false);
	assert.equal(first.targets[0].action, "cloned");
	assert.match(first.targets[0].cachePath, /consumer-source-cache/);
	assert.match(first.targets[0].head, /^[a-f0-9]{40}$/);
	assert.deepEqual(first.nextCommands, []);

	const second = await ensureConsumerSourceCaches({
		cacheRoot,
		targets: [{ id: "fixture", ref: sourceRepo, purpose: "fixture repo" }],
		staleSeconds: 300,
		offline: true,
	});

	assert.equal(second.ok, true);
	assert.equal(second.targets[0].hadCache, true);
	assert.equal(second.targets[0].action, "reused");
});

test("ensureConsumerSourceCaches reports missing remotes as blocked JSON handoff", async () => {
	const cacheRoot = mkdtempSync(path.join(os.tmpdir(), "consumer-source-cache-missing-"));
	const missingRepo = path.join(cacheRoot, "does-not-exist");
	const result = await ensureConsumerSourceCaches({
		cacheRoot,
		targets: [{ id: "missing", ref: missingRepo, purpose: "missing repo" }],
	});

	assert.equal(result.ok, false);
	assert.equal(result.targets[0].ok, false);
	assert.equal(result.targets[0].action, "failed");
	assert.match(result.targets[0].error, /git/);
	assert.deepEqual(result.nextCommands, ["pnpm run consumer:sources:cache -- --json"]);
});
