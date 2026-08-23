import assert from "node:assert/strict";
import { test } from "node:test";

import {
	entryPoints,
	isShipped,
	reachableFiles,
	unshippedFiles,
} from "./package-files-closure-gate.mjs";

/**
 * The gate that walks "a package must ship what its entry points import" had no suite of its own,
 * which put it over the scripts/ coverage ceiling the day it landed (9c43fac9, 2026-08-19) —
 * the same commit that left four `files` arrays publishing a `.tsbuildinfo`.
 *
 * A file map instead of a filesystem: every case here is a package that could exist, and none of
 * them has to.
 */
function reader(files) {
	return (target) => files[target] ?? null;
}

test("isShipped answers for the three shapes this workspace actually writes", () => {
	assert.equal(isShipped("dist/index.js", ["dist/index.js"]), true, "exact");
	assert.equal(isShipped("dist/nested/a.js", ["dist"]), true, "directory prefix");
	assert.equal(isShipped("dist/a.js", ["dist/*.js"]), true, "single-segment glob");
	assert.equal(isShipped("dist/deep/a.js", ["dist/**/*.js"]), true, "deep glob");
	assert.equal(isShipped("dist/fetch.js", ["dist/index.js"]), false, "the defect's shape");
});

test("a package with NO files list ships everything, so there is nothing to fail", () => {
	// npm's own rule. Reporting a fault here would invent one.
	assert.equal(isShipped("anything.js", undefined), true);
	assert.equal(isShipped("anything.js", []), true);
	assert.deepEqual(unshippedFiles("/pkg", { main: "./dist/index.js" }, reader({})), []);
});

test("entryPoints reaches into nested export conditions, and dedupes", () => {
	const found = entryPoints({
		exports: {
			".": { import: "./dist/index.js", types: "./dist/index.d.ts" },
			"./sub": { import: "./dist/sub.js" },
		},
		main: "./dist/index.js",
		module: "./dist/index.js",
	});
	// `.d.ts` is not an entry a consumer executes, and the same target named three ways is one file.
	assert.deepEqual(found.sort(), ["dist/index.js", "dist/sub.js"]);
});

test("reachableFiles follows relative re-exports transitively", () => {
	const files = {
		"/pkg/dist/index.js": 'export { a } from "./a.js";',
		"/pkg/dist/a.js": 'export { b } from "./nested/b.js";',
		"/pkg/dist/nested/b.js": "export const b = 1;",
	};
	const reached = reachableFiles("/pkg", { main: "./dist/index.js" }, reader(files)).sort();
	assert.deepEqual(reached, ["dist/a.js", "dist/index.js", "dist/nested/b.js"]);
});

test("a file that is not there is not this gate's fault to report", () => {
	// The build gate owns a missing file. Reporting it here would make one broken build read as a
	// packaging fault, and send whoever reads it to edit the wrong list.
	const reached = reachableFiles(
		"/pkg",
		{ main: "./dist/index.js" },
		reader({ "/pkg/dist/index.js": 'export { gone } from "./gone.js";' }),
	);
	assert.deepEqual(reached, ["dist/index.js"]);
});

test("THE DEFECT THAT ORIGINATED THIS GATE, reproduced from packages/root", () => {
	// 2026-08-19: `pnpm deploy --prod --legacy` built a tree that almost ran and died on
	//   Cannot find module '.../@refarm.dev/root/dist/fetch-with-timeout.js'
	// The package resolved everywhere it went through the workspace and broke everywhere it did
	// not, which is the worst place to find out.
	const manifest = { main: "./dist/index.js", files: ["dist/index.js", "dist/index.d.ts"] };
	const files = {
		"/root/dist/index.js": 'export { fetchWithTimeout } from "./fetch-with-timeout.js";',
		"/root/dist/fetch-with-timeout.js": "export const fetchWithTimeout = () => {};",
	};
	assert.deepEqual(unshippedFiles("/root", manifest, reader(files)), ["dist/fetch-with-timeout.js"]);
});

test("the same package is whole once the list ships the directory", () => {
	const manifest = { main: "./dist/index.js", files: ["dist"] };
	const files = {
		"/root/dist/index.js": 'export { fetchWithTimeout } from "./fetch-with-timeout.js";',
		"/root/dist/fetch-with-timeout.js": "export const fetchWithTimeout = () => {};",
	};
	assert.deepEqual(unshippedFiles("/root", manifest, reader(files)), []);
});

test("a `!` exclusion is NOT interpreted — a stated boundary, not an oversight", () => {
	// npm subtracts negated patterns; this gate does not read them. It is sound for what this gate
	// asks, because it only ever asks about files reachable by a JS import, and the workspace's
	// only negation excludes `dist/**/*.tsbuildinfo` — a compiler cache nothing imports. Written
	// down so the day someone negates a real `.js` this reads as a known edge rather than a
	// surprise: the gate would call it shipped.
	assert.equal(isShipped("dist/a.js", ["dist", "!dist/a.js"]), true);
});
