#!/usr/bin/env node
import { readFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGitSourceProvider } from "@refarm.dev/source-git";

const REF = process.env.SMOKE_SOURCE_REF ?? "aretw0/agents-lab";
const cacheRoot = mkdtempSync(path.join(os.tmpdir(), "librarian-smoke-"));
const provider = createGitSourceProvider({ cacheRoot });

const first = await provider.materialize(REF, { filter: "blob:none" });
if (first.action !== "cloned") {
	throw new Error(`expected first action 'cloned', got '${first.action}'`);
}

const status = await provider.status(REF);
if (!status.materialized || !status.path) {
	throw new Error("expected materialized status with a path");
}

const readme = readFileSync(path.join(status.path, "README.md"), "utf8");
if (readme.length === 0) {
	throw new Error("expected non-empty README.md in materialized repo");
}

const second = await provider.materialize(REF, { staleSeconds: 300 });
if (second.action !== "reused") {
	throw new Error(`expected second action 'reused', got '${second.action}'`);
}

console.log(`[librarian smoke] OK - ${REF} materialized at ${status.path} (head ${status.head})`);
