import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
		"@refarm.dev/channel-policy-v1",
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
		"@refarm.dev/channel-policy-v1",
		"@refarm.dev/effort-contract-v1",
		"@refarm.dev/launch-process",
		"@refarm.dev/release-engine",
		"@refarm.dev/ds",
		"@refarm.dev/heartwood",
		"@refarm.dev/dispatch-surface",
		"@refarm.dev/homestead-ssr",
		"@refarm.dev/silo",
	]);
	assert.equal(check.plan.orderedNames.includes("@refarm.dev/homestead-ssr"), true);
	assert.equal(check.plan.orderedNames.includes("@refarm.dev/homestead"), false);
	assert.equal(check.plan.orderedNames.includes("@refarm.dev/config"), false);
	assert.equal(check.plan.orderedNames.includes("@refarm.dev/trust"), false);
	assert.equal(check.plan.orderedNames.includes("@refarm.dev/cli"), false);

	for (const command of check.commands) {
		assert.equal(command.display, "pnpm publish --dry-run --no-git-checks");
		assert.equal(command.command.includes(" -r "), false);
	}
});

test("release check plan json exposes acceptance summary", () => {
	const output = execFileSync(
		process.execPath,
		[
			"scripts/release-check.mjs",
			"--selection",
			"vault-seed-ready",
			"--plan",
			"--json",
		],
		{
			cwd: ROOT,
			encoding: "utf8",
		},
	);
	const payload = JSON.parse(output);

	assert.equal(payload.ok, true);
	assert.equal(payload.selection.id, "vault-seed-ready");
	assert.equal(payload.acceptance.status, "accepted");
	assert.equal(payload.acceptance.packageCount, 10);
	assert.equal(payload.acceptance.blockerCount, 0);
	assert.equal(payload.acceptance.manualApprovalRequired, true);
	assert.deepEqual(payload.acceptance.profileTags, ["vault-seed-ready"]);
	assert.equal(
		payload.acceptance.requiredChecks.length,
		payload.acceptance.requiredCheckCount,
	);
});
