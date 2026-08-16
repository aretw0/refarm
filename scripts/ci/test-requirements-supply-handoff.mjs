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
// RESOLVED 2026-08-16, by the fact changing rather than the claim. vault-seed's records reference
// vault — the T3 composition proof, and the same non-test surface where `source-web` and
// `enrichment-contract-v1` earned this tag — now structures its MD/MDX lane through
// `projectContentToRecords`, and those records land in the same validated `records:v1` manifest as
// the web ETL lane. So all four members are `consumer-proven` and the profile has no hold left.
//
// WHAT THIS TEST STOPPED COVERING, said out loud rather than discovered later: with the hold empty,
// `candidate-hold` no longer has a live example HERE. The state is not dead — `source-git` and
// `source-local` carry it under `auditSourceHolds` — but this profile no longer exercises the
// middle state, and the assertion below is now a floor (nothing regressed into hold) rather than a
// demonstration that three states exist.
test("every member of the profile is consumer-proven, and none is on hold", () => {
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

	assert.equal(result.ok, true);

	// Sorted: which bucket a package lands in is the contract, the order inside a bucket is not.
	// The previous assertion happened to be alphabetical and read as if the order meant something.
	const byState = (state) =>
		result.packages
			.filter((entry) => entry.state === state)
			.map((entry) => entry.packageName)
			.sort();
	assert.deepEqual(byState("candidate-hold"), []);
	assert.deepEqual(byState("blocked"), []);
	assert.deepEqual(byState("consumer-proven"), [
		"@refarm.dev/content-projection",
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
