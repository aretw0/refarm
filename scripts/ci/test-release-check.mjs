import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
	buildReleaseCheckPlan,
	parseReleaseCheckArgs,
} from "../release-check.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("plans publish dry-runs only for default release policy packages", () => {
	const check = buildReleaseCheckPlan({
		cwd: ROOT,
		env: {
			REFARM_PACKAGE_MANAGER: "pnpm",
		},
	});

	assert.equal(check.ok, true);
	assert.deepEqual(check.plan.orderedNames, [
		"@refarm.dev/storage-contract-v1",
		"@refarm.dev/sync-contract-v1",
		"@refarm.dev/identity-contract-v1",
	]);
	assert.deepEqual(
		check.commands.map((command) => command.packageName),
		check.plan.orderedNames,
	);

	for (const command of check.commands) {
		assert.match(command.packageDir, /^packages\//);
		assert.equal(command.display, "pnpm publish --dry-run --no-git-checks");
		assert.equal(command.command.includes(" -r "), false);
		assert.deepEqual(command.args, []);
	}
});

test("parses release check package overrides", () => {
	assert.deepEqual(
		parseReleaseCheckArgs([
			"--selection",
			"default",
			"--package",
			"@refarm.dev/storage-contract-v1",
			"--plan",
			"--json",
		]),
		{
			policyPath: "release-policy.json",
			selectionId: "default",
			packageNames: ["@refarm.dev/storage-contract-v1"],
			planOnly: true,
			json: true,
		},
	);
});

test("plans vault-seed consumer-pulled publish dry-runs", () => {
	const check = buildReleaseCheckPlan({
		cwd: ROOT,
		env: {
			REFARM_PACKAGE_MANAGER: "pnpm",
		},
		selectionId: "vault-seed-ready",
	});

	assert.equal(check.ok, true);
	assert.deepEqual(check.plan.orderedNames, [
		"@refarm.dev/artifact-contract-v1",
		"@refarm.dev/effort-contract-v1",
		"@refarm.dev/config",
		"@refarm.dev/release-engine",
		"@refarm.dev/ds",
		"@refarm.dev/heartwood",
		"@refarm.dev/trust",
		"@refarm.dev/dispatch-surface",
		"@refarm.dev/homestead-ssr",
		"@refarm.dev/silo",
		"@refarm.dev/cli",
	]);
	assert.equal(check.plan.orderedNames.includes("@refarm.dev/homestead-ssr"), true);
	assert.equal(check.plan.orderedNames.includes("@refarm.dev/homestead"), false);

	for (const command of check.commands) {
		assert.equal(command.display, "pnpm publish --dry-run --no-git-checks");
		assert.equal(command.command.includes(" -r "), false);
	}
});
