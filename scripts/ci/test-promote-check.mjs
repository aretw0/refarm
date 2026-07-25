import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyChangesets, computeVerdict } from "./promote-check.mjs";

// classifyChangesets — splits pending changesets by what a merge would do with each.

test("classifyChangesets: a 0.1.0 target is guarded, a bumped target would publish, a missing one is unknown", () => {
	const versions = new Map([
		["@refarm.dev/held", "0.1.0"],
		["@refarm.dev/released", "0.2.0"],
	]);
	const changesets = [
		{ file: "a.md", packageName: "@refarm.dev/held", bump: "minor" },
		{ file: "b.md", packageName: "@refarm.dev/released", bump: "patch" },
		{ file: "c.md", packageName: "@refarm.dev/ghost", bump: "minor" },
	];
	const result = classifyChangesets({ changesets, versions });
	assert.deepEqual(result.guarded.map((r) => r.packageName), ["@refarm.dev/held"]);
	assert.deepEqual(result.wouldPublish.map((r) => r.packageName), ["@refarm.dev/released"]);
	assert.deepEqual(result.unknown.map((r) => r.packageName), ["@refarm.dev/ghost"]);
	assert.equal(result.wouldPublish[0].currentVersion, "0.2.0");
});

test("classifyChangesets: no changesets → all empty", () => {
	const result = classifyChangesets({ changesets: [], versions: new Map() });
	assert.deepEqual(result, { guarded: [], wouldPublish: [], unknown: [] });
});

// computeVerdict — the promotion decision.

test("computeVerdict: a red source is BLOCKED regardless of publish state", () => {
	const v = computeVerdict({ blocked: true, wouldPublish: [], sourceGreen: false, allowPublish: false });
	assert.equal(v.verdict, "BLOCKED");
	assert.equal(v.ok, false);
	assert.equal(v.exitCode, 1);
});

test("computeVerdict: guard blocked → SAFE, nothing publishes even with would-publish rows", () => {
	const v = computeVerdict({
		blocked: true,
		wouldPublish: [{ packageName: "x", currentVersion: "0.2.0" }],
		sourceGreen: true,
		allowPublish: false,
	});
	assert.equal(v.verdict, "SAFE");
	assert.equal(v.ok, true);
	assert.equal(v.exitCode, 0);
});

test("computeVerdict: not blocked + nothing to publish → SAFE", () => {
	const v = computeVerdict({ blocked: false, wouldPublish: [], sourceGreen: true, allowPublish: false });
	assert.equal(v.verdict, "SAFE");
	assert.equal(v.exitCode, 0);
});

test("computeVerdict: not blocked + would-publish, unconfirmed → WOULD-PUBLISH, stops (exit 2)", () => {
	const v = computeVerdict({
		blocked: false,
		wouldPublish: [{ packageName: "x", currentVersion: "0.2.0" }],
		sourceGreen: true,
		allowPublish: false,
	});
	assert.equal(v.verdict, "WOULD-PUBLISH");
	assert.equal(v.ok, false);
	assert.equal(v.exitCode, 2);
});

test("computeVerdict: not blocked + would-publish, --allow-publish → WOULD-PUBLISH accepted (exit 0)", () => {
	const v = computeVerdict({
		blocked: false,
		wouldPublish: [{ packageName: "x", currentVersion: "0.2.0" }],
		sourceGreen: true,
		allowPublish: true,
	});
	assert.equal(v.verdict, "WOULD-PUBLISH");
	assert.equal(v.ok, true);
	assert.equal(v.exitCode, 0);
});

test("computeVerdict: source status unknown (null) does not force BLOCKED", () => {
	const v = computeVerdict({ blocked: true, wouldPublish: [], sourceGreen: null, allowPublish: false });
	assert.equal(v.verdict, "SAFE");
});
