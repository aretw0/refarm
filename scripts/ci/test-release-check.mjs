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
const PRE_PUBLICATION_HANDOFF_ONLY_PACKAGES = new Set([
	"@refarm.dev/ds-astro",
	"@refarm.dev/health",
]);

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

function packageVersion(packageName, root = ROOT) {
	const check = buildReleaseCheckPlan({
		cwd: root,
		env: {
			REFARM_PACKAGE_MANAGER: "pnpm",
		},
		selectionId: "consumer-ready",
	});
	const command = check.commands.find((entry) => entry.packageName === packageName);
	if (!command) {
		throw new Error(`Unknown release package: ${packageName}`);
	}
	const packageJson = JSON.parse(
		readFileSync(path.join(root, command.packageDir, "package.json"), "utf8"),
	);
	return packageJson.version;
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
		selectionId: "consumer-ready",
	});

	assert.equal(check.ok, true);
	assert.deepEqual(check.plan.orderedNames, [
		"@refarm.dev/storage-contract-v1",
		"@refarm.dev/identity-contract-v1",
		"@refarm.dev/artifact-contract-v1",
		"@refarm.dev/channel-policy-v1",
		"@refarm.dev/effort-contract-v1",
		"@refarm.dev/quality-contract-v1",
		// 25 since 2026-08-29: `@refarm.dev/provenance-contract-v1` entered the selection, pulled by
		// arch-engine (a Python producer). Entered WITH its numbers this time: this list, the
		// four anchors in test-vault-seed-ready-handoff.mjs, test-release-check.mjs,
		// test-first-publish-selection.mjs, test-distribution-status-doc.mjs, and both docs.
		"@refarm.dev/provenance-contract-v1",
		"@refarm.dev/source-contract-v1",
		"@refarm.dev/enrichment-contract-v1",
		"@refarm.dev/records-contract-v1",
		"@refarm.dev/process-handoff",
		"@refarm.dev/health",
		"@refarm.dev/release-engine",
		"@refarm.dev/heartwood",
		"@refarm.dev/silo",
		"@refarm.dev/storage-memory",
		"@refarm.dev/credentials-contract-v1",
		"@refarm.dev/dispatch-surface",
		"@refarm.dev/ds",
		"@refarm.dev/source-web",
		// ENTERED at cc61342e ("enter the consumer-ready selection") and this list did not follow
		// it. The ratchet exists so a package joining is a line someone reviews; that commit moved
		// the fact and skipped the number, and nothing caught it until 2026-08-28.
		"@refarm.dev/vault-contract-v1",
		// After `records-contract-v1` (index 8), which it depends on — the order is topological,
		// so this position is the plan proving it knows the dependency, not an arbitrary slot.
		"@refarm.dev/content-projection",
		"@refarm.dev/identity-heartwood",
		"@refarm.dev/local-surface",
		"@refarm.dev/ds-astro",
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

test("plans the dependency-closed design system publication unit", () => {
	const check = buildReleaseCheckPlan({
		cwd: ROOT,
		env: {
			REFARM_PACKAGE_MANAGER: "pnpm",
		},
		selectionId: "design-system-ready",
	});

	assert.equal(check.ok, true);
	assert.deepEqual(check.plan.orderedNames, [
		"@refarm.dev/quality-contract-v1",
		"@refarm.dev/ds",
	]);
	assert.deepEqual(check.plan.profileTags, ["design-system-ready"]);
});

test("vault-seed-ready selection is covered by changesets provider inputs", () => {
	const check = buildReleaseCheckPlan({
		cwd: ROOT,
		env: {
			REFARM_PACKAGE_MANAGER: "pnpm",
		},
		selectionId: "consumer-ready",
	});
	const changesetPackages = changesetPackageNames();
	const missing = check.plan.orderedNames.filter(
		(name) =>
			!changesetPackages.has(name) &&
			!(
				PRE_PUBLICATION_HANDOFF_ONLY_PACKAGES.has(name) &&
				packageVersion(name) === "0.1.0"
			),
	);

	assert.equal(check.ok, true);
	assert.deepEqual(
		missing,
		[],
		"`vault-seed-ready` uses the changesets provider, so selected packages must have a changeset unless they are explicitly held as pre-publication 0.1.0 handoff-only packages.",
	);
});

test("release check plan json exposes acceptance summary", () => {
	const payload = serializeReleaseCheck(
		buildReleaseCheckPlan({
			cwd: ROOT,
			env: {
				REFARM_PACKAGE_MANAGER: "pnpm",
			},
			selectionId: "consumer-ready",
		}),
	);

	assert.equal(payload.ok, true);
	assert.equal(payload.selection.id, "consumer-ready");
	assert.equal(payload.acceptance.status, "accepted");
	// 24 since cc61342e: `@refarm.dev/vault-contract-v1` entered the selection — see the ordered
	// list above for why this number moved without any change in flight touching it.
	//
	// 23 since 2026-08-16: `@refarm.dev/content-projection` REJOINED the `consumer-ready`
	// selection. ISS-113 held it out at 22 because nothing declared a dependency on it, and refused
	// to stamp `consumer-proven` to make a test green. The bar its three profile peers meet is a
	// consumer reaching the package from a surface that is NOT the contract test, and vault-seed's
	// records reference vault now structures its MD/MDX lane through `projectContentToRecords`.
	// The tag moved because the fact moved — not to make this number move.
	assert.equal(payload.acceptance.packageCount, 25);
	assert.equal(payload.acceptance.blockerCount, 0);
	assert.equal(payload.acceptance.manualApprovalRequired, true);
	assert.deepEqual(payload.acceptance.profileTags, ["consumer-ready"]);
	assert.equal(
		payload.acceptance.requiredChecks.length,
		payload.acceptance.requiredCheckCount,
	);
});
