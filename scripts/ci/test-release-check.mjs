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
