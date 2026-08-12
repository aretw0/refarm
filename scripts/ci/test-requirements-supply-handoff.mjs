import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import test from "node:test";

import { buildRequirementsSupplyHandoff } from "./requirements-supply-handoff.mjs";

const tempRoots = [];

function makeTempRoot() {
	const root = mkdtempSync(path.join(os.tmpdir(), "requirements-supply-handoff-"));
	tempRoots.push(root);
	return root;
}

after(() => {
	for (const root of tempRoots) {
		rmSync(root, { recursive: true, force: true });
	}
});

// THE HONEST STATE, and it took two corrections to reach.
//
// This test once asserted `ok: true` over three packages. A fourth —
// `@refarm.dev/content-projection` — joined the `requirements-supply` profile carrying
// `consumer-ready` (then named vault-seed-ready) AND `candidate`, so the gate blocked. The test was
// rewritten to pin the BLOCK and name its blocker, deliberately, because making it green by
// tagging that package `consumer-proven` would have stamped "proven by a consumer" on something no
// consumer has ever pulled — manufacturing the evidence the gate exists to demand (ISS-113).
//
// Measuring settled it: NOTHING in this repository declares a dependency on
// `@refarm.dev/content-projection`. The config was contradicting itself — "ready to hand to a
// consumer" and "still a candidate" in one tag list — and the honest repair was to say the true
// thing, not to claim the false one. It carries `candidate-hold` now, and the handoff proceeds.
//
// So this asserts the third state rather than either of the first two: not proven, not blocking,
// ON HOLD until a consumer actually pulls it.
test("a member that no consumer has pulled is on HOLD, and does not block the handoff", () => {
	const handoffDir = path.join(makeTempRoot(), "empty-handoff");
	const result = buildRequirementsSupplyHandoff({
		generatedAt: "2026-06-30T00:00:00.000Z",
		handoffDir,
	});

	assert.equal(result.schema, "refarm.requirements-supply-handoff.v1");
	assert.equal(result.source, "requirements-supply-handoff");
	assert.equal(result.selection.id, "requirements-supply-candidates");
	assert.equal(result.selection.profileTag, "requirements-supply");
	assert.equal(result.selection.scope, "all");

	assert.equal(result.ok, true, "a declared hold is not a failure");

	// THREE STATES, and the middle one is the point: `candidate-hold` is neither proven nor
	// broken. A gate with only two would have to call this either a lie or a blocker.
	const byState = (state) =>
		result.packages.filter((entry) => entry.state === state).map((entry) => entry.packageName);
	assert.deepEqual(byState("candidate-hold"), ["@refarm.dev/content-projection"]);
	assert.deepEqual(byState("blocked"), []);
	assert.deepEqual(byState("consumer-proven"), [
		"@refarm.dev/enrichment-contract-v1",
		"@refarm.dev/records-contract-v1",
		"@refarm.dev/source-web",
	]);
});

test("requirements supply handoff can target clean packages first", () => {
	const handoffDir = path.join(makeTempRoot(), "empty-handoff");
	const result = buildRequirementsSupplyHandoff({
		generatedAt: "2026-06-30T00:00:00.000Z",
		scope: "clean",
		handoffDir,
	});

	assert.equal(result.ok, true);
	assert.equal(result.state, "consumer-proven");
	assert.equal(result.selection.scope, "clean");
	assert.deepEqual(
		result.packages.map((entry) => entry.packageName),
		[
			"@refarm.dev/enrichment-contract-v1",
			"@refarm.dev/records-contract-v1",
		],
	);
	assert.deepEqual(result.supportingPackages, []);
	assert.deepEqual(Object.keys(result.consumerInstall.fileSpecs), [
		"@refarm.dev/enrichment-contract-v1",
		"@refarm.dev/records-contract-v1",
	]);
	assert.deepEqual(Object.keys(result.consumerInstall.pnpmOverrides), [
		"@refarm.dev/enrichment-contract-v1",
		"@refarm.dev/records-contract-v1",
	]);
	assert.equal(result.manifestFile, "manifest.clean.json");
	assert.equal(result.distributionEvidence.expectedLocalCopies, 2);
	assert.deepEqual(result.missingTarballs, [
		"refarm.dev-enrichment-contract-v1-0.1.0.tgz",
		"refarm.dev-records-contract-v1-0.1.0.tgz",
	]);
});

test("requirements supply handoff can target source-web with source-contract support", () => {
	const handoffDir = path.join(makeTempRoot(), "empty-handoff");
	const result = buildRequirementsSupplyHandoff({
		generatedAt: "2026-06-30T00:00:00.000Z",
		scope: "source-web",
		handoffDir,
	});

	assert.equal(result.ok, true);
	assert.equal(result.state, "consumer-proven");
	assert.equal(result.selection.scope, "source-web");
	assert.deepEqual(
		result.packages.map((entry) => entry.packageName),
		["@refarm.dev/source-web"],
	);
	assert.deepEqual(
		result.supportingPackages.map((entry) => entry.packageName),
		["@refarm.dev/source-contract-v1"],
	);
	assert.deepEqual(result.consumerInstall.fileSpecs, {
		"@refarm.dev/source-web": "file:./vendor/refarm.dev-source-web-0.1.0.tgz",
	});
	assert.deepEqual(result.consumerInstall.pnpmOverrides, {
		"@refarm.dev/source-web": "file:./vendor/refarm.dev-source-web-0.1.0.tgz",
		"@refarm.dev/source-contract-v1": "file:./vendor/refarm.dev-source-contract-v1-0.1.0.tgz",
	});
	assert.deepEqual(result.consumerInstall.copyFiles, [
		"manifest.source-web.json",
		"refarm.dev-source-web-0.1.0.tgz",
		"refarm.dev-source-contract-v1-0.1.0.tgz",
	]);
	assert.equal(result.distributionEvidence.expectedLocalCopies, 2);
	assert.deepEqual(result.missingTarballs, [
		"refarm.dev-source-web-0.1.0.tgz",
		"refarm.dev-source-contract-v1-0.1.0.tgz",
	]);
});

test("requirements supply handoff reports local tarballs as consumable", () => {
	const root = makeTempRoot();
	const handoffDir = path.join(root, "handoff");
	mkdirSync(handoffDir, { recursive: true });
	const tarballs = [
		"refarm.dev-enrichment-contract-v1-0.1.0.tgz",
		"refarm.dev-records-contract-v1-0.1.0.tgz",
	];
	for (const tarball of tarballs) {
		writeFileSync(path.join(handoffDir, tarball), tarball);
	}

	const result = buildRequirementsSupplyHandoff({
		generatedAt: "2026-06-30T00:00:00.000Z",
		scope: "clean",
		handoffDir,
	});

	assert.equal(result.ok, true);
	assert.equal(result.state, "local-handoff-ready");
	assert.equal(result.consumerInstall.mode, "local-handoff-ready");
	assert.equal(result.distributionEvidence.state, "local-handoff-ready");
	assert.equal(result.distributionEvidence.verifiedLocalCopies, 2);
	assert.equal(result.distributionEvidence.expectedLocalCopies, 2);
	assert.equal(result.distributionEvidence.tarballFreshness, "checked-present");
	assert.deepEqual(result.missingTarballs, []);
	assert.match(result.packages[0].sha256, /^[a-f0-9]{64}$/);
	assert.equal(result.packages[0].sizeBytes, tarballs[0].length);
});
