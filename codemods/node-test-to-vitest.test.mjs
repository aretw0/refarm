import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	runNodeTestToVitestCli,
	transformNodeTestToVitest,
	transformNodeTestToVitestWithReport,
} from "./node-test-to-vitest.mjs";

test("node:test to vitest fixture matches expected output", () => {
	const before = readFileSync(
		new URL("./fixtures/node-test-to-vitest.before.mjs", import.meta.url),
		"utf8",
	);
	const after = readFileSync(
		new URL("./fixtures/node-test-to-vitest.after.mjs", import.meta.url),
		"utf8",
	);

	assert.equal(transformNodeTestToVitest(before), after);
	assert.deepEqual(
		{
			...transformNodeTestToVitestWithReport(before),
			code: undefined,
		},
		{
			code: undefined,
			changed: true,
			importsRewritten: 2,
			assertionsRewritten: 11,
			unhandled: [],
		},
	);
});

test("node:test to vitest is idempotent", () => {
	const after = readFileSync(
		new URL("./fixtures/node-test-to-vitest.after.mjs", import.meta.url),
		"utf8",
	);

	assert.equal(transformNodeTestToVitest(after), after);
});

test("node:test to vitest reports unsupported assertions without dropping them", () => {
	const source = `import assert from "node:assert/strict";\nimport test from "node:test";\n\ntest("custom", () => {\n\tassert.ifError(error);\n});\n`;
	const result = transformNodeTestToVitestWithReport(source);

	assert.equal(result.importsRewritten, 2);
	assert.equal(result.assertionsRewritten, 0);
	assert.deepEqual(result.unhandled, ["unhandled assertion: assert.ifError"]);
	assert.match(result.code, /assert\.ifError\(error\)/);
});

test("node:test to vitest cli can emit a dry-run json report", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "refarm-node-test-codemod-"));
	const input = path.join(root, "sample.test.mjs");
	writeFileSync(
		input,
		'import assert from "node:assert/strict";\nimport { test } from "node:test";\n\ntest("ok", () => {\n\tassert.equal(1, 1);\n});\n',
		"utf8",
	);
	let stdout = "";

	const status = runNodeTestToVitestCli(
		[
			"--input",
			input,
			"--json",
		],
		{ stdout: { write: (chunk) => { stdout += chunk; } } },
	);

	assert.equal(status, 0);
	assert.deepEqual(JSON.parse(stdout), {
		input,
		changed: true,
		importsRewritten: 2,
		assertionsRewritten: 1,
		unhandled: [],
		written: false,
	});
	assert.match(readFileSync(input, "utf8"), /from "node:test"/);
});
