import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const scriptPath = path.resolve("scripts/ci/check-node-substrate.mjs");

function makeWorkspace({
	packageManager = "pnpm@11.7.0",
	platform = process.platform,
	withBins = false,
	withForeignBins = false,
	withDevcontainerNodeModulesVolume = false,
	withCliRuntimePackage = false,
	withWorkspaceLinkPackage = false,
	workspaceLinkPackageCount = withWorkspaceLinkPackage ? 1 : 0,
	withMaterializedWorkspaceLink = false,
} = {}) {
	const tempDir = mkdtempSync(path.join(tmpdir(), "refarm-node-substrate-"));
	const binExt = platform === "win32" ? ".cmd" : "";
	writeFileSync(
		path.join(tempDir, "package.json"),
		`${JSON.stringify({ packageManager }, null, 2)}\n`,
		"utf8",
	);

	if (withBins) {
		const binDir = path.join(tempDir, "node_modules", ".bin");
		mkdirSync(binDir, { recursive: true });
		for (const binary of ["vitest", "tsc", "eslint"]) {
			writeFileSync(path.join(binDir, `${binary}${binExt}`), "", "utf8");
		}
	}

	if (withForeignBins) {
		const foreignExt = platform === "win32" ? "" : ".cmd";
		const binDir = path.join(tempDir, "node_modules", ".bin");
		mkdirSync(binDir, { recursive: true });
		for (const binary of ["vitest", "tsc", "eslint"]) {
			writeFileSync(path.join(binDir, `${binary}${foreignExt}`), "", "utf8");
		}
	}

	if (withDevcontainerNodeModulesVolume) {
		mkdirSync(path.join(tempDir, ".devcontainer"), { recursive: true });
		writeFileSync(
			path.join(tempDir, ".devcontainer", "devcontainer.json"),
			`${JSON.stringify({
				mounts: [
					`source=refarm-node-modules,target=${path.join(tempDir, "node_modules")},type=volume`,
				],
			}, null, 2)}\n`,
			"utf8",
		);
	}

	if (withCliRuntimePackage) {
		const packageDir = path.join(tempDir, "apps", "sample-cli");
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(
			path.join(packageDir, "package.json"),
			`${JSON.stringify({
				name: "@sample/cli",
				type: "module",
				bin: {
					sample: "./dist/index.js",
				},
				dependencies: {
					chalk: "^5.6.2",
					"@sample/internal": "workspace:*",
				},
			}, null, 2)}\n`,
			"utf8",
		);
	}

	for (let index = 0; index < workspaceLinkPackageCount; index += 1) {
		const packageDir = path.join(tempDir, "packages", index === 0 ? "consumer" : `consumer-${index}`);
		mkdirSync(packageDir, { recursive: true });
		writeFileSync(
			path.join(packageDir, "package.json"),
			`${JSON.stringify({
				name: index === 0 ? "@sample/consumer" : `@sample/consumer-${index}`,
				type: "module",
				dependencies: {
					"@sample/internal": "workspace:*",
				},
			}, null, 2)}\n`,
			"utf8",
		);
		if (withMaterializedWorkspaceLink) {
			const dependencyDir = path.join(packageDir, "node_modules", "@sample", "internal");
			mkdirSync(dependencyDir, { recursive: true });
			writeFileSync(
				path.join(dependencyDir, "package.json"),
				`${JSON.stringify({ name: "@sample/internal" }, null, 2)}\n`,
				"utf8",
			);
		}
	}

	return tempDir;
}

function runCheck(cwd, args = ["--json"], env = {}) {
	return spawnSync(process.execPath, [scriptPath, ...args], {
		cwd,
		encoding: "utf8",
		env: { ...process.env, ...env },
		stdio: ["ignore", "pipe", "pipe"],
	});
}

test("node substrate check reports missing workspace execution shims", () => {
	const tempDir = makeWorkspace();
	try {
		const result = runCheck(tempDir);
		assert.notEqual(result.status, 0);
		assert.equal(result.stderr, "");

		const payload = JSON.parse(result.stdout);
		assert.equal(payload.ok, false);
		assert.equal(payload.packageManager, "pnpm@11.7.0");
		assert.equal(payload.nextCommand, "pnpm install --frozen-lockfile --config.confirm-modules-purge=false");
		assert.deepEqual(
			payload.missing.map((check) => check.id),
			[
				"node_modules",
				"node_modules_bin",
				"bin_vitest",
				"bin_tsc",
				"bin_eslint",
			],
		);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("node substrate check uses detected frozen install command outside pnpm", () => {
	const tempDir = makeWorkspace({ packageManager: "npm@11.0.0" });
	try {
		const result = runCheck(tempDir);
		assert.notEqual(result.status, 0);

		const payload = JSON.parse(result.stdout);
		assert.equal(payload.ok, false);
		assert.equal(payload.packageManager, "npm@11.0.0");
		assert.equal(payload.nextCommand, "npm ci");
		assert.deepEqual(payload.nextCommands, ["npm ci"]);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("node substrate check reports shims generated for a different platform", () => {
	const tempDir = makeWorkspace({ withForeignBins: true });
	try {
		const result = runCheck(tempDir);
		assert.notEqual(result.status, 0);

		const payload = JSON.parse(result.stdout);
		assert.equal(payload.ok, false);
		assert.deepEqual(
			payload.foreignPlatformShims.map((shim) => shim.binary),
			["vitest", "tsc", "eslint"],
		);
		assert.match(payload.nextAction, /Run validation inside the environment that owns this node_modules tree/);
		assert.equal(payload.nextCommand, null);
		assert.deepEqual(payload.recommendations, [
			"Run validation inside the environment that owns this node_modules tree, or rebuild/reopen the devcontainer so node_modules is isolated per platform.",
			"Do not run package-manager install from this platform against the current shared node_modules tree.",
		]);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("node substrate check passes when required package manager shims exist", () => {
	const tempDir = makeWorkspace({ withBins: true });
	try {
		const result = runCheck(tempDir);
		assert.equal(result.status, 0, result.stderr);

		const payload = JSON.parse(result.stdout);
		assert.equal(payload.ok, true);
		assert.deepEqual(payload.missing, []);
		assert.deepEqual(payload.recommendations, []);
		assert.equal(payload.nextCommand, null);
		assert.deepEqual(payload.nextCommands, []);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("node substrate check reports unresolved external runtime dependencies for CLI packages", () => {
	const tempDir = makeWorkspace({ withBins: true, withCliRuntimePackage: true });
	try {
		const result = runCheck(tempDir);
		assert.notEqual(result.status, 0);

		const payload = JSON.parse(result.stdout);
		assert.equal(payload.ok, false);
		assert.deepEqual(
			payload.missingRuntimeDependencies.map((dependency) => [
				dependency.package,
				dependency.dependency,
			]),
			[["@sample/cli", "chalk"]],
		);
		assert.equal(payload.nextCommand, "pnpm install --frozen-lockfile --config.confirm-modules-purge=false");
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("node substrate check reports missing workspace dependency links", () => {
	const tempDir = makeWorkspace({ withBins: true, withWorkspaceLinkPackage: true });
	try {
		const result = runCheck(tempDir);
		assert.notEqual(result.status, 0);

		const payload = JSON.parse(result.stdout);
		assert.equal(payload.ok, false);
		assert.deepEqual(
			payload.missingWorkspaceDependencyLinks.map((dependency) => [
				dependency.package,
				dependency.dependency,
			]),
			[["@sample/consumer", "@sample/internal"]],
		);
		assert.equal(payload.nextCommand, "pnpm install --frozen-lockfile --config.confirm-modules-purge=false");
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("node substrate check does not rebuild a shared Windows checkout without opt-in", () => {
	const tempDir = makeWorkspace({
		platform: "win32",
		withBins: true,
		workspaceLinkPackageCount: 21,
	});
	try {
		const result = runCheck(tempDir, ["--json"], {
			REFARM_NODE_SUBSTRATE_PLATFORM: "win32",
		});
		assert.notEqual(result.status, 0);

		const payload = JSON.parse(result.stdout);
		assert.equal(payload.ok, false);
		assert.equal(payload.platform, "win32");
		assert.equal(payload.workspaceMaterialization.id, "shared_workspace_node_modules_materialization");
		assert.equal(payload.workspaceMaterialization.localRebuildOptIn, false);
		assert.equal(payload.workspaceMaterialization.localRebuildCommand, "pnpm install --frozen-lockfile --config.confirm-modules-purge=false");
		assert.match(payload.nextAction, /separate checkout for this platform/);
		assert.equal(payload.nextCommand, null);
		assert.deepEqual(payload.nextCommands, []);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("node substrate human output does not print undefined secondary guidance", () => {
	const tempDir = makeWorkspace({
		platform: "win32",
		withBins: true,
		workspaceLinkPackageCount: 21,
	});
	try {
		const result = runCheck(tempDir, [], {
			REFARM_NODE_SUBSTRATE_PLATFORM: "win32",
		});
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /node-substrate: missing package-manager execution substrate/);
		assert.doesNotMatch(result.stderr, /undefined/);
		assert.doesNotMatch(result.stderr, /if this is a devcontainer on Windows/);
		assert.match(result.stderr, /\.\.\. 1 more workspace dependency link\(s\)/);
		assert.match(result.stderr, /next: Current checkout appears to be materialized/);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("node substrate check can explicitly opt in to rebuilding a shared Windows checkout", () => {
	const tempDir = makeWorkspace({
		platform: "win32",
		withBins: true,
		workspaceLinkPackageCount: 21,
	});
	try {
		const result = runCheck(tempDir, ["--json"], {
			REFARM_NODE_SUBSTRATE_ALLOW_REBUILD: "1",
			REFARM_NODE_SUBSTRATE_PLATFORM: "win32",
		});
		assert.notEqual(result.status, 0);

		const payload = JSON.parse(result.stdout);
		assert.equal(payload.workspaceMaterialization.localRebuildOptIn, true);
		assert.equal(payload.nextCommand, "pnpm install --frozen-lockfile --config.confirm-modules-purge=false");
		assert.deepEqual(payload.nextCommands, ["pnpm install --frozen-lockfile --config.confirm-modules-purge=false"]);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("node substrate check accepts materialized workspace dependency links", () => {
	const tempDir = makeWorkspace({
		withBins: true,
		withWorkspaceLinkPackage: true,
		withMaterializedWorkspaceLink: true,
	});
	try {
		const result = runCheck(tempDir);
		assert.equal(result.status, 0, result.stderr);

		const payload = JSON.parse(result.stdout);
		assert.equal(payload.ok, true);
		assert.deepEqual(payload.missingWorkspaceDependencyLinks, []);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("node substrate check fails when devcontainer node_modules volume is not mounted", () => {
	if (process.platform !== "linux") return;
	const tempDir = makeWorkspace({
		withBins: true,
		withDevcontainerNodeModulesVolume: true,
	});
	try {
		const result = runCheck(tempDir, ["--json"], {
			REFARM_NODE_SUBSTRATE_MOUNTINFO: `36 29 0:32 / ${tempDir} rw,relatime - 9p C: rw\n`,
		});
		assert.notEqual(result.status, 0);

		const payload = JSON.parse(result.stdout);
		assert.equal(payload.ok, false);
		assert.equal(payload.missing.length, 0);
		assert.equal(payload.mountIssues.length, 1);
		assert.equal(payload.mountIssues[0].id, "devcontainer_node_modules_mount");
		assert.match(payload.nextAction, /rebuild\/reopen the devcontainer/);
		assert.equal(payload.nextCommand, null);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("node substrate check rejects unknown arguments", () => {
	const tempDir = makeWorkspace();
	try {
		const result = runCheck(tempDir, ["--unknown"]);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Usage: node scripts\/ci\/check-node-substrate\.mjs \[--json\]/);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});
