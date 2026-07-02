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
			unsupported: [],
			renameToMjs: false,
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
	assert.deepEqual(result.unsupported, []);
	assert.equal(result.renameToMjs, false);
	assert.match(result.code, /assert\.ifError\(error\)/);
});

test("node:test to vitest maps message args for common assert import forms", () => {
	const cases = [
		{
			source: `import * as assert from "node:assert/strict";\nassert.ok(value, "value message");\n`,
			expected: `import { expect } from "vitest";\nexpect(value, "value message").toBeTruthy();\n`,
		},
		{
			source: `import assert from "node:assert";\nassert.match(actual, /ok/, "match message");\n`,
			expected: `import { expect } from "vitest";\nexpect(actual, "match message").toMatch(/ok/);\n`,
		},
		{
			source: `import { strict as assert } from "node:assert";\nassert.doesNotMatch(actual, /bad/, "negative message");\n`,
			expected: `import { expect } from "vitest";\nexpect(actual, "negative message").not.toMatch(/bad/);\n`,
		},
	];

	for (const item of cases) {
		assert.equal(transformNodeTestToVitest(item.source), item.expected);
	}
});

test("node:test to vitest maps simple CommonJS requires", () => {
	const source = `const test = require("node:test");\nconst assert = require("node:assert/strict");\n\ntest("ok", () => {\n\tassert.equal(1, 1);\n});\n`;
	const result = transformNodeTestToVitestWithReport(source);

	assert.equal(result.changed, true);
	assert.equal(result.importsRewritten, 2);
	assert.equal(result.assertionsRewritten, 1);
	assert.deepEqual(result.unhandled, []);
	assert.deepEqual(result.unsupported, []);
	assert.equal(result.renameToMjs, true);
	assert.equal(
		result.code,
		`import { test, expect } from "vitest";\n\ntest("ok", () => {\n\texpect(1).toBe(1);\n});\n`,
	);
});

test("node:test to vitest tolerates a leading utf8 bom before imports", () => {
	const source = `\uFEFFimport assert from "node:assert/strict";\nimport test from "node:test";\n\ntest("bom", () => {\n\tassert.equal(1, 1);\n});\n`;
	const output = transformNodeTestToVitest(source);

	assert.equal(
		output,
		`import { test, expect } from "vitest";\n\ntest("bom", () => {\n\texpect(1).toBe(1);\n});\n`,
	);
	assert.equal(output.charCodeAt(0), "i".charCodeAt(0));
});

test("node:test to vitest rewrites CommonJS test files and reports mjs rename", () => {
	const before = readFileSync(
		new URL("./fixtures/node-test-to-vitest-cjs.before.js", import.meta.url),
		"utf8",
	);
	const after = readFileSync(
		new URL("./fixtures/node-test-to-vitest-cjs.after.mjs", import.meta.url),
		"utf8",
	);
	const result = transformNodeTestToVitestWithReport(before);

	assert.equal(result.code, after);
	assert.equal(result.changed, true);
	assert.equal(result.importsRewritten, 9);
	assert.equal(result.assertionsRewritten, 3);
	assert.deepEqual(result.unhandled, []);
	assert.deepEqual(result.unsupported, []);
	assert.equal(result.renameToMjs, true);
});

test("node:test to vitest reports unsupported CommonJS require forms", () => {
	const source = `const nodeTest = require("node:test");\nconst { equal } = require("node:assert");\n`;
	const result = transformNodeTestToVitestWithReport(source);

	assert.equal(result.changed, false);
	assert.equal(result.importsRewritten, 0);
	assert.deepEqual(result.unsupported, [
		"unsupported CommonJS require: node:test; migrate the file to ESM before applying this codemod",
		"unsupported CommonJS require: node:assert; migrate the file to ESM before applying this codemod",
	]);
	assert.equal(result.renameToMjs, false);
});

test("node:test to vitest handles throws predicate and doesNotReject function semantics", () => {
	const source = `import assert from "node:assert/strict";\nimport test from "node:test";\n\ntest("runtime semantics", async () => {\n\tassert.throws(() => {\n\t\tconst error = new Error("bad");\n\t\terror.code = "BAD";\n\t\tthrow error;\n\t}, (error) => error.code === "BAD", "code matches");\n\tawait assert.rejects(async () => {\n\t\tconst error = new Error("async bad");\n\t\terror.code = "ASYNC_BAD";\n\t\tthrow error;\n\t}, (error) => error.code === "ASYNC_BAD", "async code matches");\n\tawait assert.doesNotReject(() => Promise.resolve("ok"), "does not reject");\n});\n`;
	const output = transformNodeTestToVitest(source);

	assert.match(output, /__refarmDidThrow/);
	assert.match(output, /expect\(__refarmDidThrow, "code matches"\)\.toBe\(true\)/);
	assert.match(output, /expect\(\(\(error\) => error\.code === "BAD"\)\(__refarmThrown\), "code matches"\)\.toBeTruthy\(\)/);
	assert.match(output, /await \(async \(\) => \{ let __refarmDidThrow = false; let __refarmThrown; try \{ await \(async \(\) => \{/);
	assert.match(output, /expect\(__refarmDidThrow, "async code matches"\)\.toBe\(true\)/);
	assert.match(output, /expect\(\(\(error\) => error\.code === "ASYNC_BAD"\)\(__refarmThrown\), "async code matches"\)\.toBeTruthy\(\)/);
	assert.match(output, /expect\(\(\(\) => Promise\.resolve\("ok"\)\)\(\), "does not reject"\)\.resolves\.not\.toThrow\(\)/);
});

test("node:test to vitest preserves regex literals with structural characters", () => {
	const source = `import assert from "node:assert/strict";\nimport test from "node:test";\n\ntest("css", () => {\n\tassert.doesNotMatch(css, /\\s*:root\\[[^\\]]+\\],\\s*body\\)/, "selector should not leak");\n});\n`;
	const output = transformNodeTestToVitest(source);

	assert.equal(
		output,
		`import { test, expect } from "vitest";\n\ntest("css", () => {\n\texpect(css, "selector should not leak").not.toMatch(/\\s*:root\\[[^\\]]+\\],\\s*body\\)/);\n});\n`,
	);
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
		unsupported: [],
		renameToMjs: false,
		written: false,
	});
	assert.match(readFileSync(input, "utf8"), /from "node:test"/);
});
