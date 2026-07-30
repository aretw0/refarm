import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { checkVendor, readBuiltBlock, readVendoredBlock, VENDORED } from "../scripts/vendor.mjs";

/**
 * The anti-drift check.
 *
 * The kit carries `@refarm.dev/prompt-contract-v1` so a phone with nothing but
 * Node can be ASKED for the farm's name using the same block every other surface
 * uses. Carrying a copy is only legitimate while the copy IS the block — the
 * moment it forks, "we consume the block" becomes a comfortable fiction and the
 * kit is back to a private reimplementation, which is the exact failure this
 * repo has been correcting.
 *
 * So the copy is verified on every test run, byte for byte. `checkVendor()`
 * builds the block when its (gitignored) dist is absent rather than skipping:
 * a check that quietly passes when it cannot look is not a check.
 */

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the vendored block is byte-identical to the built source", async () => {
	const result = await checkVendor();
	assert.equal(
		result.ok,
		true,
		`vendor/prompt-contract-v1.mjs drifted from ${VENDORED.block} (${result.reason}): ${result.detail}\n` +
			`Fix with: node scripts/vendor.mjs`,
	);
});

test("checkVendor reports drift rather than passing when the bytes differ", async () => {
	// Mutation guard for the check itself: feed it a copy that is NOT the block
	// and require a "drift" verdict. Without this, a checkVendor() that always
	// returned { ok: true } would sail through the test above.
	const built = await readBuiltBlock();
	const vendored = await readVendoredBlock();
	assert.notEqual(vendored, null, "the vendored copy must exist");
	assert.equal(built.equals(vendored), true);

	const tampered = Buffer.concat([vendored, Buffer.from("\n// drift\n")]);
	assert.equal(built.equals(tampered), false, "a tampered copy must not compare equal");
});

test("the vendored block exposes the prompt contract the kit consumes", async () => {
	const block = await import("../vendor/prompt-contract-v1.mjs");
	for (const name of [
		"createStdioOperatorChannel",
		"createScriptedOperatorChannel",
		"createAutoOperatorChannel",
		"OperatorPromptCancelledError",
		"PROMPT_CAPABILITY",
	]) {
		assert.ok(name in block, `vendored block is missing ${name}`);
	}
	assert.equal(block.PROMPT_CAPABILITY, "prompt:v1");
});

test("the vendored block stays installable-free — node built-ins only", async () => {
	const source = await readFile(VENDORED.vendorPath, "utf8");
	const specifiers = [...source.matchAll(/^\s*import\s[^"']*["']([^"']+)["']/gm)].map((m) => m[1]);
	assert.deepEqual(specifiers, ["node:readline"]);
});

test("farm-client declares no runtime dependencies — the phone constraint is load-bearing", async () => {
	const pkg = JSON.parse(await readFile(join(PKG_DIR, "package.json"), "utf8"));
	assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
	assert.deepEqual(Object.keys(pkg.peerDependencies ?? {}), []);
	assert.deepEqual(Object.keys(pkg.optionalDependencies ?? {}), []);
	// vendor/ must ship — otherwise the kit that asks is not the kit that installs.
	assert.ok(pkg.files.includes("vendor"), "package.json files must include vendor/");
});
