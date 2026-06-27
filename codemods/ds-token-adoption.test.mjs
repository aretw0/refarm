import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { transformDsTokenAdoption } from "./ds-token-adoption.mjs";

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
