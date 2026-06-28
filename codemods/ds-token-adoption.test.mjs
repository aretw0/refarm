import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	runDsTokenAdoptionCli,
	transformDsTokenAdoption,
	transformDsTokenAdoptionWithReport,
} from "./ds-token-adoption.mjs";

test("ds token adoption fixture matches expected output", () => {
	const before = readFileSync(
		new URL("./fixtures/ds-token-adoption.before.css", import.meta.url),
		"utf8",
	);
	const after = readFileSync(
		new URL("./fixtures/ds-token-adoption.after.css", import.meta.url),
		"utf8",
	);

	assert.equal(transformDsTokenAdoption(before), after);
	assert.deepEqual(
		{
			...transformDsTokenAdoptionWithReport(before),
			css: undefined,
		},
		{
			css: undefined,
			changed: true,
			importsAdded: 3,
			semanticDeclarationsRemoved: 13,
		},
	);
});

test("ds token adoption is idempotent", () => {
	const after = readFileSync(
		new URL("./fixtures/ds-token-adoption.after.css", import.meta.url),
		"utf8",
	);

	assert.equal(transformDsTokenAdoption(after), after);
});

test("ds token adoption preserves nested at-rules", () => {
	const before = `:root {\n  --background: #fff;\n  --gdg-grid-line: var(--border);\n}\n\n@media (max-width: 44rem) {\n  :root[data-vault-marimo-theme=\"light\"] {\n    --background: #fff;\n  }\n\n  .panel {\n    color: var(--foreground);\n  }\n}\n`;
	const expected = `@import "@refarm.dev/ds/tokens.css";\n@import "@refarm.dev/ds/themes/verde-jardim.css";\n@import "@refarm.dev/ds/components.css";\n\n:root {\n  --gdg-grid-line: var(--border);\n}\n\n@media (max-width: 44rem) {\n  :root[data-vault-marimo-theme=\"light\"] {\n    --background: #fff;\n  }\n\n  .panel {\n    color: var(--foreground);\n  }\n}\n`;

	assert.equal(transformDsTokenAdoption(before), expected);
});

test("ds token adoption cli can emit a dry-run json report", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "refarm-ds-token-codemod-"));
	const input = path.join(root, "marimo-vault.css");
	writeFileSync(input, ":root {\n  --background: #fff;\n}\n", "utf8");
	let stdout = "";

	const status = runDsTokenAdoptionCli(
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
		importsAdded: 3,
		semanticDeclarationsRemoved: 1,
		written: false,
	});
	assert.equal(readFileSync(input, "utf8"), ":root {\n  --background: #fff;\n}\n");
});
