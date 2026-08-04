import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { parseArgs, resolvePackageDir } from "./onboarding-doctor.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("parseArgs accepts --json and --package", () => {
	const parsed = parseArgs(["--json", "--package", "@refarm.dev/model-catalog-v1"]);
	assert.equal(parsed.json, true);
	assert.equal(parsed.packageRef, "@refarm.dev/model-catalog-v1");
});

test("parseArgs rejects unknown flags", () => {
	assert.throws(() => parseArgs(["--wat"]), /unknown argument/);
});

test("parseArgs enforces package value", () => {
	assert.throws(() => parseArgs(["--package"]), /requires a value/);
});

test("resolvePackageDir maps scoped package names", () => {
	const dir = resolvePackageDir("/repo", "@refarm.dev/model-catalog-v1");
	assert.equal(dir, path.join("/repo", "packages", "model-catalog-v1"));
});

test("resolvePackageDir maps plain package names into packages/", () => {
	const dir = resolvePackageDir("/repo", "prompt-contract-v1");
	assert.equal(dir, path.join("/repo", "packages", "prompt-contract-v1"));
});

test("resolvePackageDir keeps explicit workspace prefixes", () => {
	const dir = resolvePackageDir("/repo", "packages/prompt-contract-v1");
	assert.equal(dir, path.join("/repo", "packages", "prompt-contract-v1"));
});

test("onboarding-doctor reports editor noise guidance when showConfig succeeds", () => {
	const result = spawnSync(
		process.execPath,
		["scripts/ci/onboarding-doctor.mjs", "--json", "--package", "packages/source-git"],
		{
			cwd: ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	assert.equal(result.status, 0, result.stderr);
	const payload = JSON.parse(result.stdout);
	assert.equal(payload.ok, true);
	assert.equal(payload.editorNoiseLikely, true);
	assert.ok(Array.isArray(payload.editorNoiseAdvice));
	assert.ok(payload.editorNoiseAdvice.length > 0);
});
