import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildReleaseCheckPlan } from "../release-check.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const doc = readFileSync(
	path.join(ROOT, "packages/DISTRIBUTION_STATUS.md"),
	"utf8",
);
const packageRegistryDoc = readFileSync(
	path.join(ROOT, "packages/README.md"),
	"utf8",
);
const vaultSeedConvergenceDoc = readFileSync(
	path.join(ROOT, "docs/VAULT_SEED_CONVERGENCE.md"),
	"utf8",
);
const crossRepoConsumptionDoc = readFileSync(
	path.join(ROOT, "docs/DEV_CROSS_REPO_CONSUMPTION.md"),
	"utf8",
);
const releaseGateDoc = readFileSync(
	path.join(ROOT, "docs/v0.1.0-release-gate.md"),
	"utf8",
);
const factoryReadinessDoc = readFileSync(
	path.join(ROOT, "docs/CONVERGENCE_FACTORY_READINESS.md"),
	"utf8",
);
const vaultSeedHandoffPlan = readFileSync(
	path.join(ROOT, "docs/superpowers/plans/2026-06-26-vault-seed-ready-handoff.md"),
	"utf8",
);

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function releaseSelectionNames(selectionId = "default") {
	const check = buildReleaseCheckPlan({
		cwd: ROOT,
		env: {
			REFARM_PACKAGE_MANAGER: "pnpm",
		},
		selectionId,
	});
	assert.equal(check.ok, true);
	return check.plan.orderedNames;
}

test("distribution status reflects release-policy selections", () => {
	assert.doesNotMatch(
		doc,
		/READY FOR v0\.1\.0 ALPHA DISTRIBUTION \(3 Contracts\)/,
	);
	assert.match(doc, /daily-driver gate/);
	assert.match(doc, /kernel-candidates/);
	assert.match(doc, /vault-seed-ready/);
	assert.match(doc, /schemaVersion: 1/);
	assert.match(doc, /consumerPull/);
	assert.match(doc, /consumerInstall/);
	assert.match(doc, /consumerProofs/);
	assert.match(doc, /distributionEvidence/);
	assert.match(doc, /prunedExtra/);
	assert.match(doc, /proofId/);
	assert.match(doc, /\.refarm\/handoff\/vault-seed\/<YYYY-MM-DD>\//);
	assert.match(doc, /manifest\.json/);
	assert.match(doc, /manifest\.md/);
	assert.match(doc, /--out \.refarm\/handoff\/vault-seed\/<YYYY-MM-DD>\/manifest\.json/);
	assert.match(doc, /official consumer checkout should collect the `\.tgz` files/);
	assert.match(doc, /tarball freshness/);
	assert.match(doc, /publishable build-output\s+freshness/);
	assert.doesNotMatch(
		doc,
		/currently lives under\s+`\.refarm\/handoff\/vault-seed\/\d{4}-\d{2}-\d{2}\//,
	);

	for (const packageName of releaseSelectionNames("default")) {
		assert.match(doc, new RegExp(`\\\`${escapeRegExp(packageName)}\\\``));
	}

	for (const packageName of releaseSelectionNames("vault-seed-ready")) {
		assert.match(doc, new RegExp(`\\\`${escapeRegExp(packageName)}\\\``));
	}
});

test("package registry does not promise publication ahead of release policy", () => {
	assert.doesNotMatch(packageRegistryDoc, /Target v0\.1\.0/);
	assert.doesNotMatch(packageRegistryDoc, /READY FOR v0\.1\.0/);
	assert.match(packageRegistryDoc, /daily-driver gate/);
	assert.match(packageRegistryDoc, /kernel-candidates/);
	assert.match(packageRegistryDoc, /vault-seed-ready/);

	for (const packageName of releaseSelectionNames("default")) {
		assert.match(
			packageRegistryDoc,
			new RegExp(`\\[\\\`${escapeRegExp(packageName)}\\\``),
		);
	}
});

test("vault seed convergence keeps current handoff hashes in the manifest", () => {
	const currentHandoffSection = vaultSeedConvergenceDoc
		.split("**2026-06-30 full `vault-seed-ready` handoff:**")[1]
		.split("### Additional Assimilation Matrix")[0];

	assert.match(currentHandoffSection, /packages\[\]\.sha256/);
	assert.match(currentHandoffSection, /manifest\.json/);
	assert.match(currentHandoffSection, /manifest\.md/);
	assert.match(currentHandoffSection, /packages\[\]\.tarball/);
	assert.match(currentHandoffSection, /consumerInstall\.fileSpecs/);
	assert.match(currentHandoffSection, /consumerInstall\.pnpmOverrides/);
	assert.match(currentHandoffSection, /distributionEvidence/);
	assert.match(currentHandoffSection, /prunedExtra/);
	assert.doesNotMatch(currentHandoffSection, /\b[a-f0-9]{64}\b/);
});

test("cross-repo consumption uses the current vault-seed-ready packet", () => {
	assert.match(crossRepoConsumptionDoc, /vault-seed-ready/);
	assert.match(crossRepoConsumptionDoc, /release:vault-seed:check -- --plan --json/);
	assert.match(crossRepoConsumptionDoc, /--out \.refarm\/handoff\/vault-seed\/<YYYY-MM-DD>\/manifest\.json/);
	assert.match(crossRepoConsumptionDoc, /manifest\.json/);
	assert.match(crossRepoConsumptionDoc, /manifest\.md/);
	assert.match(crossRepoConsumptionDoc, /consumerInstall\.fileSpecs/);
	assert.match(crossRepoConsumptionDoc, /consumerInstall\.pnpmOverrides/);
	assert.match(crossRepoConsumptionDoc, /consumerProofs/);
	assert.match(crossRepoConsumptionDoc, /distributionEvidence\.currentRef/);
	assert.doesNotMatch(crossRepoConsumptionDoc, /`@refarm\.dev\/ds`, `\/homestead`, `\/silo`/);
});

test("vault-seed handoff docs distinguish historical 10-package packets from current selection", () => {
	const currentSelection = releaseSelectionNames("vault-seed-ready");
	assert.equal(currentSelection.length, 18);

	assert.match(releaseGateDoc, /current 18-package selection/);
	assert.match(releaseGateDoc, /materialized the then-current 10-package selection/);
	assert.match(
		releaseGateDoc,
		/ADR-072 superseded that packet before\s+publication/,
	);
	assert.match(vaultSeedHandoffPlan, /historical 2026-06-26/);
	assert.match(vaultSeedHandoffPlan, /active `vault-seed-ready` selection is\s+> now 18 packages and 49 required checks/);
});

test("factory readiness records the current local vault-seed handoff state", () => {
	assert.match(factoryReadinessDoc, /local handoff ready/);
	assert.match(factoryReadinessDoc, /\.refarm\/handoff\/vault-seed\/2026-07-01\/manifest\.json/);
	assert.match(factoryReadinessDoc, /distributionEvidence\.state: "local-handoff-ready"/);
	assert.match(factoryReadinessDoc, /18 tarballs/);
});
