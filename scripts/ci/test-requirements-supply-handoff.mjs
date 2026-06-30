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

test("requirements supply handoff plans candidate packages without promotion", () => {
	const handoffDir = path.join(makeTempRoot(), "empty-handoff");
	const result = buildRequirementsSupplyHandoff({
		generatedAt: "2026-06-30T00:00:00.000Z",
		handoffDir,
	});

	assert.equal(result.schema, "refarm.requirements-supply-handoff.v1");
	assert.equal(result.source, "requirements-supply-handoff");
	assert.equal(result.ok, true);
	assert.equal(result.state, "candidate-hold");
	assert.equal(result.selection.id, "requirements-supply-candidates");
	assert.equal(result.selection.profileTag, "requirements-supply");
	assert.equal(result.selection.scope, "all");
	assert.equal(result.selection.selectedForVaultSeedReady, false);
	assert.deepEqual(
		result.packages.map((entry) => entry.packageName),
		[
			"@refarm.dev/enrichment-contract-v1",
			"@refarm.dev/records-contract-v1",
			"@refarm.dev/source-web",
		],
	);

	for (const entry of result.packages) {
		assert.equal(entry.version, "0.1.0");
		assert.equal(entry.state, "candidate-hold");
		assert.equal(entry.selectedForVaultSeedReady, false);
		assert.ok(entry.tags.includes("requirements-supply"));
		assert.ok(entry.tags.includes("boundary-review"));
		assert.ok(entry.tags.includes("candidate-hold"));
		assert.ok(entry.mustPassChecks.length >= 4);
		assert.ok(entry.consumerPull.proofId.startsWith("requirements-"));
		assert.match(entry.consumerPull.fallback, /consumer/);
		assert.equal(entry.exists, false);
		assert.equal(entry.sha256, null);
		assert.deepEqual(entry.issues, []);
	}

	const sourceWeb = result.packages.find((entry) => entry.packageName === "@refarm.dev/source-web");
	assert.deepEqual(sourceWeb.refarmDependencies, [
		{
			packageName: "@refarm.dev/source-contract-v1",
			version: "0.1.0",
			packageDir: "packages/source-contract-v1",
			tarball: "refarm.dev-source-contract-v1-0.1.0.tgz",
			publishable: true,
		},
	]);
	assert.equal(result.supportingPackages.length, 1);
	assert.equal(result.supportingPackages[0].packageName, "@refarm.dev/source-contract-v1");
	assert.equal(result.supportingPackages[0].exists, false);
	assert.equal(result.supportingPackages[0].sha256, null);
	assert.match(
		result.supportingPackages[0].path,
		/refarm\.dev-source-contract-v1-0\.1\.0\.tgz$/,
	);
	assert.equal(
		result.consumerInstall.fileSpecs["@refarm.dev/source-web"],
		"file:./vendor/refarm.dev-source-web-0.1.0.tgz",
	);
	assert.equal(
		result.consumerInstall.pnpmOverrides["@refarm.dev/source-contract-v1"],
		"file:./vendor/refarm.dev-source-contract-v1-0.1.0.tgz",
	);
	assert.deepEqual(result.consumerInstall.copyFiles, [
		"manifest.json",
		"refarm.dev-enrichment-contract-v1-0.1.0.tgz",
		"refarm.dev-records-contract-v1-0.1.0.tgz",
		"refarm.dev-source-web-0.1.0.tgz",
		"refarm.dev-source-contract-v1-0.1.0.tgz",
	]);
	assert.equal(result.consumerProofs.length, result.packages.length);
	assert.equal(result.distributionEvidence.state, "candidate-hold");
	assert.equal(result.distributionEvidence.verifiedLocalCopies, 0);
	assert.equal(result.distributionEvidence.expectedLocalCopies, 4);
	assert.match(result.distributionEvidence.promotionBoundary, /downstream proof/);
	assert.match(result.boundaries.join("\n"), /packs only when --pack is explicit/);
	assert.match(result.boundaries.join("\n"), /not vault-seed-ready artifacts/);
	assert.match(result.nextActions.join("\n"), /consumer checkout records a named proof/);
	assert.deepEqual(result.missingTarballs, [
		"refarm.dev-enrichment-contract-v1-0.1.0.tgz",
		"refarm.dev-records-contract-v1-0.1.0.tgz",
		"refarm.dev-source-web-0.1.0.tgz",
		"refarm.dev-source-contract-v1-0.1.0.tgz",
	]);
	assert.deepEqual(result.issues, []);
});

test("requirements supply handoff can target clean packages first", () => {
	const handoffDir = path.join(makeTempRoot(), "empty-handoff");
	const result = buildRequirementsSupplyHandoff({
		generatedAt: "2026-06-30T00:00:00.000Z",
		scope: "clean",
		handoffDir,
	});

	assert.equal(result.ok, true);
	assert.equal(result.state, "candidate-hold");
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
	assert.equal(result.distributionEvidence.expectedLocalCopies, 2);
	assert.deepEqual(result.missingTarballs, [
		"refarm.dev-enrichment-contract-v1-0.1.0.tgz",
		"refarm.dev-records-contract-v1-0.1.0.tgz",
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
