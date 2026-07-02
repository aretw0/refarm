import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const registry = JSON.parse(
	readFileSync(new URL("./registry.json", import.meta.url), "utf8"),
);
const rootPackage = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
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

test("codemods check script runs every ready codemod test", () => {
	const command = rootPackage.scripts?.["codemods:check"];
	assert.ok(command, "root package.json missing codemods:check");

	for (const entry of registry.entries.filter(
		(candidate) => candidate.status === "ready" && candidate.tool === "codemod",
	)) {
		const testPath = `codemods/${entry.id}.test.mjs`;
		assert.ok(existsSync(testPath), `${entry.id} test missing: ${testPath}`);
		assert.match(
			command,
			new RegExp(
				`(^|\\s)${testPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`,
			),
			`${entry.id} is ready but codemods:check does not run ${testPath}`,
		);
	}
});

test("release readiness runs every ready codemod test", () => {
	const command = rootPackage.scripts?.["release:readiness:test"];
	assert.ok(command, "root package.json missing release:readiness:test");

	for (const entry of registry.entries.filter(
		(candidate) => candidate.status === "ready" && candidate.tool === "codemod",
	)) {
		const testPath = `codemods/${entry.id}.test.mjs`;
		assert.ok(existsSync(testPath), `${entry.id} test missing: ${testPath}`);
		assert.match(
			command,
			new RegExp(
				`(^|\\s)${testPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`,
			),
			`${entry.id} is ready but release:readiness:test does not run ${testPath}`,
		);
	}
});
