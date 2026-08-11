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

// THE HONEST STATE, which is `blocked`, and the reason is a real config gap rather than a stale
// expectation. This test asserted `ok: true` / `state: "consumer-proven"` over a list of three
// packages. A FOURTH — `@refarm.dev/content-projection` — has since joined the
// `requirements-supply` profile WITHOUT the `consumer-proven` tag and without its consumer-proof
// metadata, so the gate blocks and says which package and why.
//
// The gate is right. Making this green by tagging that package would be stamping "proven by a
// consumer" on something no consumer has pulled — manufacturing the evidence the gate exists to
// demand. The config gap is ISS-113; this test now pins what the gate ACTUALLY reports, including
// the name of the blocker, so the day it is resolved this test fails and gets updated
// deliberately.
test("requirements supply handoff blocks on a profile member with no consumer proof", () => {
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
	assert.equal(result.selection.selectedForVaultSeedReady, true);

	assert.equal(result.ok, false, "a profile member with no consumer proof must block");
	assert.equal(result.state, "blocked");

	const blocked = result.packages.filter((entry) => entry.state === "blocked");
	assert.deepEqual(
		blocked.map((entry) => entry.packageName),
		["@refarm.dev/content-projection"],
	);
	assert.ok(
		blocked[0].issues.some((issue) => issue.includes("missing consumer-proven tag")),
		`expected a named reason, got ${JSON.stringify(blocked[0].issues)}`,
	);

	// The other three ARE proven, and that must not be lost in the block: a gate that reports
	// only its blocker hides the progress behind it.
	assert.deepEqual(
		result.packages.filter((entry) => entry.state === "consumer-proven").map((entry) => entry.packageName),
		[
			"@refarm.dev/enrichment-contract-v1",
			"@refarm.dev/records-contract-v1",
			"@refarm.dev/source-web",
		],
	);
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
