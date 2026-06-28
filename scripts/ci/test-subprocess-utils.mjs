import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { runSubprocess } from "./subprocess-utils.mjs";

test("runSubprocess preserves captured output on failure", async () => {
	const fakeSpawn = () => {
		const child = new EventEmitter();
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		queueMicrotask(() => {
			child.stdout.emit("data", "captured stdout\n");
			child.stderr.emit("data", "captured stderr\n");
			child.emit("exit", 7);
		});
		return child;
	};

	await assert.rejects(
		runSubprocess(
			process.execPath,
			[
				"-e",
				"console.log('captured stdout'); console.error('captured stderr'); process.exit(7);",
			],
			{ captureOutput: true, spawn: fakeSpawn },
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
