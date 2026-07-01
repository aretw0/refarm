import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
	buildReleaseCheckPlan,
	parseReleaseCheckArgs,
	serializeReleaseCheck,
} from "../release-check.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function changesetPackageNames(root = ROOT) {
	const changesetDir = path.join(root, ".changeset");
	const names = new Set();

	for (const entry of readdirSync(changesetDir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "README.md") {
			continue;
		}
		const text = readFileSync(path.join(changesetDir, entry.name), "utf8");
		const match = text.match(/^---\n([\s\S]*?)\n---/);
		if (!match) {
			continue;
		}
		for (const line of match[1].split("\n")) {
			const parsed = line.match(/^\"([^\"]+)\":\s*(patch|minor|major)\s*$/);
			if (parsed) {
				names.add(parsed[1]);
			}
		}
	}

	return names;
}

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
			"--",
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
		"@refarm.dev/storage-contract-v1",
		"@refarm.dev/identity-contract-v1",
		"@refarm.dev/artifact-contract-v1",
		"@refarm.dev/channel-policy-v1",
		"@refarm.dev/effort-contract-v1",
		"@refarm.dev/source-contract-v1",
		"@refarm.dev/enrichment-contract-v1",
		"@refarm.dev/records-contract-v1",
		"@refarm.dev/process-handoff",
		"@refarm.dev/release-engine",
		"@refarm.dev/ds",
		"@refarm.dev/heartwood",
		"@refarm.dev/silo",
		"@refarm.dev/storage-memory",
		"@refarm.dev/credentials-contract-v1",
		"@refarm.dev/dispatch-surface",
		"@refarm.dev/source-web",
		"@refarm.dev/identity-heartwood",
	]);
	assert.equal(check.plan.orderedNames.includes("@refarm.dev/homestead-ssr"), false);
	assert.equal(check.plan.orderedNames.includes("@refarm.dev/homestead"), false);
	assert.equal(check.plan.orderedNames.includes("@refarm.dev/launch-process"), false);
	assert.equal(check.plan.orderedNames.includes("@refarm.dev/config"), false);
	assert.equal(check.plan.orderedNames.includes("@refarm.dev/trust"), false);
	assert.equal(check.plan.orderedNames.includes("@refarm.dev/cli"), false);

	for (const command of check.commands) {
		assert.equal(command.display, "pnpm publish --dry-run --no-git-checks");
		assert.equal(command.command.includes(" -r "), false);
	}
});

test("vault-seed-ready selection is covered by changesets provider inputs", () => {
	const check = buildReleaseCheckPlan({
		cwd: ROOT,
		env: {
			REFARM_PACKAGE_MANAGER: "pnpm",
		},
		selectionId: "vault-seed-ready",
	});
	const changesetPackages = changesetPackageNames();
	const missing = check.plan.orderedNames.filter((name) => !changesetPackages.has(name));

	assert.equal(check.ok, true);
	assert.deepEqual(
		missing,
		[],
		"`vault-seed-ready` uses the changesets provider, so every selected package must have a changeset before publication handoff.",
	);
});

test("release check plan json exposes acceptance summary", () => {
	const payload = serializeReleaseCheck(
		buildReleaseCheckPlan({
			cwd: ROOT,
			env: {
				REFARM_PACKAGE_MANAGER: "pnpm",
			},
			selectionId: "vault-seed-ready",
		}),
	);

	assert.equal(payload.ok, true);
	assert.equal(payload.selection.id, "vault-seed-ready");
	assert.equal(payload.acceptance.status, "accepted");
	assert.equal(payload.acceptance.packageCount, 18);
	assert.equal(payload.acceptance.blockerCount, 0);
	assert.equal(payload.acceptance.manualApprovalRequired, true);
	assert.deepEqual(payload.acceptance.profileTags, ["vault-seed-ready"]);
	assert.equal(
		payload.acceptance.requiredChecks.length,
		payload.acceptance.requiredCheckCount,
	);
});
