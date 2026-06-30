import assert from "node:assert/strict";
import test from "node:test";

import { buildRequirementsSupplyHandoff } from "./requirements-supply-handoff.mjs";

test("requirements supply handoff plans candidate packages without promotion", () => {
	const result = buildRequirementsSupplyHandoff({
		generatedAt: "2026-06-30T00:00:00.000Z",
	});

	assert.equal(result.schema, "refarm.requirements-supply-handoff.v1");
	assert.equal(result.source, "requirements-supply-handoff");
	assert.equal(result.ok, true);
	assert.equal(result.state, "candidate-hold");
	assert.equal(result.selection.id, "requirements-supply-candidates");
	assert.equal(result.selection.profileTag, "requirements-supply");
	assert.equal(result.selection.selectedForVaultSeedReady, false);
	assert.deepEqual(
		result.packages.map((entry) => entry.packageName),
		[
			"@refarm.dev/source-web",
			"@refarm.dev/enrichment-contract-v1",
			"@refarm.dev/records-contract-v1",
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
	assert.deepEqual(result.supportingPackages, sourceWeb.refarmDependencies);
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
		"refarm.dev-source-web-0.1.0.tgz",
		"refarm.dev-enrichment-contract-v1-0.1.0.tgz",
		"refarm.dev-records-contract-v1-0.1.0.tgz",
		"refarm.dev-source-contract-v1-0.1.0.tgz",
	]);
	assert.equal(result.consumerProofs.length, result.packages.length);
	assert.equal(result.distributionEvidence.state, "candidate-hold");
	assert.equal(result.distributionEvidence.verifiedLocalCopies, 0);
	assert.match(result.distributionEvidence.promotionBoundary, /downstream proof/);
	assert.match(result.boundaries.join("\n"), /does not pack tarballs/);
	assert.match(result.boundaries.join("\n"), /does not write \.refarm\/handoff artifacts/);
	assert.match(result.nextActions.join("\n"), /consumer checkout records a named proof/);
	assert.deepEqual(result.issues, []);
});
