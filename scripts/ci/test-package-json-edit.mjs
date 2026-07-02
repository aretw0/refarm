#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { replaceTopLevelJsonStringProperty } from "../package-json-edit.mjs";

test("updates a package version without reformatting tabs or key order", () => {
	const raw = `{
\t"name": "@refarm.dev/example",
\t"version": "0.1.0",
\t"description": "keeps local formatting",
\t"files": [
\t\t"dist"
\t]
}
`;

	assert.equal(
		replaceTopLevelJsonStringProperty(raw, "version", "0.1.1"),
		`{
\t"name": "@refarm.dev/example",
\t"version": "0.1.1",
\t"description": "keeps local formatting",
\t"files": [
\t\t"dist"
\t]
}
`,
	);
});

test("updates a package version without reformatting two-space manifests", () => {
	const raw = `{
  "name": "@refarm.dev/example",
  "version": "0.1.0",
  "files": [
    "dist"
  ]
}
`;

	assert.equal(
		replaceTopLevelJsonStringProperty(raw, "version", "0.2.0"),
		`{
  "name": "@refarm.dev/example",
  "version": "0.2.0",
  "files": [
    "dist"
  ]
}
`,
	);
});

test("rejects missing string fields instead of rewriting whole manifests", () => {
	assert.throws(
		() => replaceTopLevelJsonStringProperty('{"name":"@refarm.dev/example"}\n', "version", "0.1.0"),
		/package\.json is missing "version"/,
	);
});
