import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const registry = JSON.parse(
	readFileSync(new URL("./registry.json", import.meta.url), "utf8"),
);

const STATUS = new Set(["candidate", "ready", "implemented", "retired"]);
const TOOL = new Set([
	"generator",
	"ast-grep",
	"ts-morph",
	"codemod",
	"manual-reviewed",
]);
const REQUIRED = [
	"id",
	"status",
	"ownerSurface",
	"tool",
	"inputs",
	"fixtures",
	"verificationGate",
	"rollbackNote",
];

test("registry entries are well-formed", () => {
	assert.equal(registry.version, 1);
	assert.ok(Array.isArray(registry.entries) && registry.entries.length > 0);

	const ids = new Set();
	for (const entry of registry.entries) {
		for (const key of REQUIRED) {
			assert.ok(key in entry, `${entry.id ?? "?"} missing ${key}`);
		}
		assert.ok(STATUS.has(entry.status), `${entry.id} bad status`);
		assert.ok(TOOL.has(entry.tool), `${entry.id} bad tool`);
		assert.ok(Array.isArray(entry.inputs), `${entry.id} inputs must be array`);
		assert.ok(
			Array.isArray(entry.fixtures),
			`${entry.id} fixtures must be array`,
		);
		assert.ok(!ids.has(entry.id), `duplicate id ${entry.id}`);
		ids.add(entry.id);
	}
});

test("ready entries carry fixtures and a dry-run command", () => {
	for (const entry of registry.entries.filter(
		(candidate) =>
			candidate.status === "ready" || candidate.status === "implemented",
	)) {
		assert.ok(entry.fixtures.length > 0, `${entry.id} ready but no fixtures`);
		assert.ok(entry.dryRunCommand, `${entry.id} ready but no dryRunCommand`);
		for (const fixture of entry.fixtures) {
			assert.ok(existsSync(fixture), `${entry.id} fixture missing: ${fixture}`);
		}
	}
});
