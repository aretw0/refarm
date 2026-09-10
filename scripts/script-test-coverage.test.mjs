import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	BASELINE_MAX_UNCOVERED,
	isProductionScript,
	judgeCoverage,
	productionScripts,
} from "./script-test-coverage.mjs";

/** A package.json shaped like the real registry: script names mapped to `node --test` commands. */
const REGISTRY = {
	scripts: {
		"thing:test": "node --test scripts/thing.test.mjs",
		"other:test": "node --test scripts/ci/test-other-lib.mjs",
		build: "tsc -b",
	},
};

test("a suite is not production, by the convention the runner matches on", () => {
	assert.equal(isProductionScript("scripts/thing.mjs"), true);
	assert.equal(isProductionScript("scripts/thing.test.mjs"), false);
	assert.equal(isProductionScript("scripts/ci/test-other-lib.mjs"), false);
	// A README beside a script is not a script.
	assert.equal(isProductionScript("scripts/notes.md"), false);
});

test("covered means THE LANE WOULD RUN SOMETHING, not that a similar name exists", () => {
	const verdict = judgeCoverage(REGISTRY, ["scripts/thing.mjs", "scripts/other.mjs", "scripts/lonely.mjs"]);
	assert.deepEqual(verdict.covered, ["scripts/thing.mjs", "scripts/other.mjs"]);
	assert.deepEqual(verdict.uncovered, ["scripts/lonely.mjs"]);
	assert.equal(verdict.total, 3);
});

test("the TOTAL is reported, so a growing surface is distinguishable from a rising ceiling", () => {
	// A ratchet that reported only a ratio would go green for deleting tested files.
	const verdict = judgeCoverage(REGISTRY, ["scripts/lonely.mjs"]);
	assert.equal(verdict.total, 1);
	assert.equal(verdict.covered.length, 0);
});

test("an empty registry covers nothing, rather than covering everything vacuously", () => {
	const verdict = judgeCoverage({ scripts: {} }, ["scripts/thing.mjs"]);
	assert.deepEqual(verdict.uncovered, ["scripts/thing.mjs"]);
});

test("the ceiling holds against the real tree", () => {
	// The ratchet's own subject. This is the assertion that fails when a slice adds an untested
	// script — including the slice that added THIS file, which is how the gate proved itself: it
	// reported delta +1 the moment it existed, and went back to 0 when this suite was written.
	const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	const verdict = judgeCoverage(packageJson, productionScripts());
	assert.ok(
		verdict.uncovered.length <= BASELINE_MAX_UNCOVERED,
		`${verdict.uncovered.length} uncovered against a ceiling of ${BASELINE_MAX_UNCOVERED}:\n` +
			verdict.uncovered.slice(0, 10).join("\n"),
	);
});
