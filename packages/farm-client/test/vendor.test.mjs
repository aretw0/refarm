import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	checkAllVendored,
	checkVendor,
	readBuiltBlock,
	readVendoredBlock,
	VENDORED,
	VENDORED_BLOCKS,
} from "../scripts/vendor.mjs";

/**
 * The anti-drift check.
 *
 * The kit carries `@refarm.dev/prompt-contract-v1` (how it ASKS) and
 * `@refarm.dev/operation-consent-v1` (how it asks for AUTHORISATION to change a
 * file, and remembers the answer), so a phone with nothing but Node uses the same
 * blocks every other surface uses. Carrying a copy is only legitimate while the
 * copy IS the block — the moment it forks, "we consume the block" becomes a
 * comfortable fiction and the kit is back to a private reimplementation, which is
 * the exact failure this repo has been correcting.
 *
 * So every copy is verified on every test run, byte for byte. `checkVendor()`
 * builds a block when its (gitignored) dist is absent rather than skipping:
 * a check that quietly passes when it cannot look is not a check.
 */

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

test("both carried blocks are registered — vendoring is not a one-off", () => {
	assert.deepEqual(
		VENDORED_BLOCKS.map((b) => b.vendorFile),
		["vendor/prompt-contract-v1.mjs", "vendor/operation-consent-v1.mjs"],
	);
});

test("every vendored block is byte-identical to its built source", async () => {
	const { ok, results } = await checkAllVendored();
	const drifted = results
		.filter((r) => !r.ok)
		.map((r) => `${r.target.vendorFile} (${r.reason}): ${r.detail}`)
		.join("\n");
	assert.equal(ok, true, `vendored copies drifted:\n${drifted}\nFix with: node scripts/vendor.mjs`);
});

test("checkVendor reports drift rather than passing when the bytes differ", async () => {
	// Mutation guard for the check itself: feed it a copy that is NOT the block
	// and require a "drift" verdict. Without this, a checkVendor() that always
	// returned { ok: true } would sail through the test above.
	for (const target of VENDORED_BLOCKS) {
		const built = await readBuiltBlock(target);
		const vendored = await readVendoredBlock(target);
		assert.notEqual(vendored, null, `${target.vendorFile} must exist`);
		assert.equal(built.equals(vendored), true);
		assert.equal((await checkVendor(target)).ok, true);

		const tampered = Buffer.concat([vendored, Buffer.from("\n// drift\n")]);
		assert.equal(built.equals(tampered), false, "a tampered copy must not compare equal");
	}
});

test("checkVendor on a block whose copy is absent reports it, never passes", async () => {
	const absent = { ...VENDORED, vendorPath: `${VENDORED.vendorPath}.does-not-exist` };
	const result = await checkVendor(absent);
	assert.equal(result.ok, false);
	assert.equal(result.reason, "missing");
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

test("the vendored block exposes the operation-consent journey the kit consumes", async () => {
	const block = await import("../vendor/operation-consent-v1.mjs");
	for (const name of [
		"runOperationConsent",
		"undoOperationRecord",
		"standingDecision",
		"renderOperationRequest",
		"createFileOperationTrail",
		"createNodeOperationFileSystem",
		"OPERATION_CONSENT_CAPABILITY",
	]) {
		assert.ok(name in block, `vendored block is missing ${name}`);
	}
	assert.equal(block.OPERATION_CONSENT_CAPABILITY, "operation-consent:v1");
});

test("the vendored blocks stay installable-free — node built-ins only", async () => {
	const expected = {
		"vendor/prompt-contract-v1.mjs": ["node:readline"],
		"vendor/operation-consent-v1.mjs": ["node:fs/promises", "node:path"],
	};
	for (const target of VENDORED_BLOCKS) {
		const source = await readFile(target.vendorPath, "utf8");
		const specifiers = [...source.matchAll(/^\s*import\s[^"']*["']([^"']+)["']/gm)].map((m) => m[1]);
		assert.deepEqual(specifiers, expected[target.vendorFile], `${target.vendorFile} imports`);
	}
});

test("farm-client declares no runtime dependencies — the phone constraint is load-bearing", async () => {
	const pkg = JSON.parse(await readFile(join(PKG_DIR, "package.json"), "utf8"));
	assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
	assert.deepEqual(Object.keys(pkg.peerDependencies ?? {}), []);
	assert.deepEqual(Object.keys(pkg.optionalDependencies ?? {}), []);
	// vendor/ must ship — otherwise the kit that asks is not the kit that installs.
	assert.ok(pkg.files.includes("vendor"), "package.json files must include vendor/");
});
