import assert from "node:assert/strict";
import test from "node:test";
import {
	normalizeAuditVulnerabilities,
	parseWorkspaceOverridesText,
	patchedMinimumVersion,
	planAuditFixes,
	renderWorkspaceOverridesText,
} from "../security/audit-fix-lib.mjs";

test("normalizes pnpm advisory audit output", () => {
	const vulnerabilities = normalizeAuditVulnerabilities({
		advisories: {
			"123": {
				module_name: "ws",
				vulnerable_versions: ">=8.0.0 <8.20.1",
				patched_versions: ">=8.20.1",
			},
		},
	});

	assert.deepEqual(vulnerabilities, {
		ws: {
			range: ">=8.0.0 <8.20.1",
			patchedVersions: ">=8.20.1",
			fixAvailable: true,
		},
	});
	assert.equal(patchedMinimumVersion(vulnerabilities.ws), "8.20.1");
});

test("parses and renders workspace overrides with quoted package keys", () => {
	const state = parseWorkspaceOverridesText([
		"packages:",
		"  - packages/*",
		"overrides:",
		"  esbuild: 0.28.1",
		'  "@scope/pkg": "1.2.3"',
		'  "yaml-language-server>yaml": "2.8.1"',
		"catalog:",
		"  typescript: ^6.0.3",
		"",
	].join("\n"));

	assert.deepEqual(state.overrides, {
		esbuild: "0.28.1",
		"@scope/pkg": "1.2.3",
		"yaml-language-server>yaml": "2.8.1",
	});

	state.overrides.ws = "8.20.1";
	assert.equal(renderWorkspaceOverridesText(state), [
		"packages:",
		"  - packages/*",
		"overrides:",
		'  "@scope/pkg": 1.2.3',
		"  esbuild: 0.28.1",
		"  ws: 8.20.1",
		'  "yaml-language-server>yaml": 2.8.1',
		"catalog:",
		"  typescript: ^6.0.3",
		"",
	].join("\n"));
});

test("plans workspace override for transitive vulnerabilities", () => {
	const plan = planAuditFixes({
		vulnerabilities: {
			ws: {
				range: ">=8.0.0 <8.20.1",
				patchedVersions: ">=8.20.1",
				fixAvailable: true,
			},
		},
		workspacePackages: [],
		workspaceOverrides: {},
		safeVersionFor: () => "8.20.1",
	});

	assert.equal(plan.changed, true);
	assert.deepEqual(plan.workspaceOverrides, { ws: "8.20.1" });
	assert.deepEqual(plan.packageUpdates, []);
});

test("keeps catalog dependencies centralized and remediates through workspace override", () => {
	const workspacePackage = {
		name: "packages/example",
		data: {
			dependencies: {
				esbuild: "catalog:",
			},
		},
	};

	const plan = planAuditFixes({
		vulnerabilities: {
			esbuild: {
				range: "<0.28.1",
				patchedVersions: ">=0.28.1",
				fixAvailable: true,
			},
		},
		workspacePackages: [workspacePackage],
		workspaceOverrides: {},
		safeVersionFor: () => "0.28.1",
	});

	assert.equal(plan.changed, true);
	assert.deepEqual(workspacePackage.data.dependencies, { esbuild: "catalog:" });
	assert.deepEqual(plan.workspaceOverrides, { esbuild: "0.28.1" });
	assert.deepEqual(plan.packageUpdates, []);
});

test("bumps direct non-catalog workspace dependencies", () => {
	const workspacePackage = {
		name: "apps/example",
		data: {
			devDependencies: {
				"left-pad": "^1.0.0",
			},
		},
	};

	const plan = planAuditFixes({
		vulnerabilities: {
			"left-pad": {
				range: "<1.3.0",
				patchedVersions: ">=1.3.0",
				fixAvailable: true,
			},
		},
		workspacePackages: [workspacePackage],
		workspaceOverrides: {},
		safeVersionFor: () => "1.3.0",
	});

	assert.equal(plan.changed, true);
	assert.deepEqual(workspacePackage.data.devDependencies, { "left-pad": "^1.3.0" });
	assert.deepEqual(plan.workspaceOverrides, {});
	assert.deepEqual(plan.packageUpdates, [workspacePackage]);
});
