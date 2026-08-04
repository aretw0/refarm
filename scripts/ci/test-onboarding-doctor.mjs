import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { parseArgs, resolvePackageDir } from "./onboarding-doctor.mjs";

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
