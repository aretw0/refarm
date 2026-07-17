import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import { basePackage, computeWorkspaceDrift, extractRefarmSpecifiers } from "./check-src-dep-manifest.mjs";

const scriptPath = path.resolve("scripts/ci/check-src-dep-manifest.mjs");

test("basePackage strips subpaths to the scoped package", () => {
	assert.equal(basePackage("@refarm.dev/wallet"), "@refarm.dev/wallet");
	assert.equal(basePackage("@refarm.dev/wallet/sovereign"), "@refarm.dev/wallet");
	assert.equal(basePackage("@refarm.dev/capability-host/node"), "@refarm.dev/capability-host");
});

test("extractRefarmSpecifiers picks up imports, not string mentions", () => {
	// This is the precision that separates a real MISSING dep from a dead path-map:
	// devbench-t1 mentions `@refarm.dev/tractor` only inside pnpm command STRINGS.
	const source = [
		`import { a } from "@refarm.dev/static";`,
		`import type { T } from "@refarm.dev/typeonly";`,
		`export { b } from "@refarm.dev/reexport";`,
		`const m = await import("@refarm.dev/dynamic");`,
		`import "@refarm.dev/sideeffect";`,
		`const r = require("@refarm.dev/required");`,
		`const cmd = "pnpm --filter @refarm.dev/tractor run build";`, // a STRING, not an import
		`// see @refarm.dev/commented for details`, // a COMMENT
	].join("\n");
	const found = extractRefarmSpecifiers(source);
	assert.ok(found.has("@refarm.dev/static"));
	assert.ok(found.has("@refarm.dev/typeonly"));
	assert.ok(found.has("@refarm.dev/reexport"));
	assert.ok(found.has("@refarm.dev/dynamic"));
	assert.ok(found.has("@refarm.dev/sideeffect"));
	assert.ok(found.has("@refarm.dev/required"));
	// The pnpm-command string must NOT be read as an import (else a dead path-map
	// would masquerade as a real dependency).
	assert.ok(!found.has("@refarm.dev/tractor"), "must not treat a string mention as an import");
	assert.ok(!found.has("@refarm.dev/commented"), "must not treat a comment as an import");
});

test("computeWorkspaceDrift flags a MISSING dep imported in src but not declared", () => {
	const drift = computeWorkspaceDrift({
		ownName: "@refarm.dev/self",
		declared: new Set(),
		runtimeDeps: [],
		importedBases: new Map([["@refarm.dev/used", "src/x.ts"]]),
		pathMapBases: new Set(),
		workspaceIndex: new Set(["@refarm.dev/used"]),
	});
	assert.deepEqual(drift.missing, [{ base: "@refarm.dev/used", sampleFile: "src/x.ts" }]);
});

test("computeWorkspaceDrift flags a STALE path-map not backed by a declared dep", () => {
	const drift = computeWorkspaceDrift({
		ownName: "@refarm.dev/self",
		declared: new Set(),
		runtimeDeps: [],
		importedBases: new Map(),
		pathMapBases: new Set(["@refarm.dev/ghost"]),
		workspaceIndex: new Set(["@refarm.dev/ghost"]),
	});
	assert.deepEqual(drift.stalePathMaps, [{ base: "@refarm.dev/ghost" }]);
});

test("computeWorkspaceDrift flags an UNUSED runtime dep neither imported nor path-mapped", () => {
	const drift = computeWorkspaceDrift({
		ownName: "@refarm.dev/self",
		declared: new Set(["@refarm.dev/dead"]),
		runtimeDeps: ["@refarm.dev/dead"],
		importedBases: new Map(),
		pathMapBases: new Set(),
		workspaceIndex: new Set(["@refarm.dev/dead"]),
	});
	assert.deepEqual(drift.unused, [{ base: "@refarm.dev/dead" }]);
});

test("computeWorkspaceDrift never flags a self-import or a non-workspace alias", () => {
	const drift = computeWorkspaceDrift({
		ownName: "@refarm.dev/self",
		declared: new Set(),
		runtimeDeps: [],
		// self-subpath import + an alias that is NOT a real workspace package (e.g. locales)
		importedBases: new Map([
			["@refarm.dev/self", "src/a.ts"],
			["@refarm.dev/locales", "src/b.ts"],
		]),
		pathMapBases: new Set(["@refarm.dev/self", "@refarm.dev/locales"]),
		workspaceIndex: new Set(["@refarm.dev/self"]), // locales is deliberately absent
	});
	assert.deepEqual(drift.missing, [], "self-import and alias must not be MISSING");
	assert.deepEqual(drift.stalePathMaps, [], "self-path-map and alias path-map must not be STALE");
});

test("computeWorkspaceDrift clears UNUSED when the dep is used via a path-map only", () => {
	const drift = computeWorkspaceDrift({
		ownName: "@refarm.dev/self",
		declared: new Set(["@refarm.dev/typesonly"]),
		runtimeDeps: ["@refarm.dev/typesonly"],
		importedBases: new Map(),
		pathMapBases: new Set(["@refarm.dev/typesonly"]),
		workspaceIndex: new Set(["@refarm.dev/typesonly"]),
	});
	assert.deepEqual(drift.unused, [], "a dep referenced by a path-map counts as used");
});

test("the real monorepo is clean — no MISSING deps or STALE path-maps (regression guard)", () => {
	const result = spawnSync("node", [scriptPath, "--json"], { encoding: "utf8" });
	assert.equal(result.status, 0, `checker exited ${result.status}:\n${result.stdout}\n${result.stderr}`);
	const report = JSON.parse(result.stdout);
	assert.equal(report.ok, true);
	const offenders = report.reports.filter((r) => r.missing.length || r.stalePathMaps.length);
	assert.deepEqual(
		offenders.map((r) => r.rel),
		[],
		"workspaces with missing/stale drift — fix or remove the path-map",
	);
});
