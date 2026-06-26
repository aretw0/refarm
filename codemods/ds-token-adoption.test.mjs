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
