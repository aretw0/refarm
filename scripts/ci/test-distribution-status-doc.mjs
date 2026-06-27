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
