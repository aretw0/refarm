import assert from "node:assert/strict";
import test from "node:test";
import { runSubprocess } from "./subprocess-utils.mjs";

test("runSubprocess preserves captured output on failure", async () => {
	await assert.rejects(
		runSubprocess(
			process.execPath,
			[
				"-e",
				"console.log('captured stdout'); console.error('captured stderr'); process.exit(7);",
			],
			{ captureOutput: true },
		),
		(error) => {
			assert.equal(error.exitCode, 7);
			assert.equal(error.command, process.execPath);
			assert.deepEqual(error.args, [
				"-e",
				"console.log('captured stdout'); console.error('captured stderr'); process.exit(7);",
			]);
			assert.equal(error.stdout, "captured stdout\n");
			assert.equal(error.stderr, "captured stderr\n");
			assert.match(error.message, /captured stderr/);
			return true;
		},
	);
});
