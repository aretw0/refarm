import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const helperPath = path.resolve("scripts/package-manager.sh");

function sh(script, env = {}) {
	return spawnSync("sh", ["-c", `. "${helperPath}"; ${script}`], {
		encoding: "utf8",
		env: { ...process.env, ...env },
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function makePackageRoot(packageManager) {
	const tempDir = mkdtempSync(path.join(tmpdir(), "refarm-package-manager-sh-"));
	writeFileSync(
		path.join(tempDir, "package.json"),
		`${JSON.stringify({ packageManager }, null, 2)}\n`,
		"utf8",
	);
	return tempDir;
}

test("shell package manager helper honors operator override", () => {
	const result = sh('resolve_package_manager "$PWD"', {
		REFARM_PACKAGE_MANAGER: "bun@1.3.0",
	});

	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, "bun");
});

test("shell package manager helper reads packageManager from package.json", () => {
	const tempDir = makePackageRoot("pnpm@11.7.0");
	try {
		const result = sh(`resolve_package_manager ${JSON.stringify(tempDir)}`);

		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stdout, "pnpm");
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("shell package manager helper formats frozen install commands", () => {
	const cases = [
		["pnpm", "pnpm install --frozen-lockfile"],
		["npm", "npm ci"],
		["yarn", "yarn install --immutable"],
		["bun", "bun install --frozen-lockfile"],
	];

	for (const [packageManager, expected] of cases) {
		const result = sh(`install_command_for_package_manager ${packageManager} true`);

		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stdout, expected);
	}
});

test("shell package manager helper formats workspace binary commands", () => {
	const cases = [
		["pnpm", "pnpm -C apps/refarm exec turbo run test"],
		["npm", "npm --prefix apps/refarm exec -- turbo run test"],
		["yarn", "yarn --cwd apps/refarm turbo run test"],
		["bun", "bun --cwd apps/refarm x turbo run test"],
	];

	for (const [packageManager, expected] of cases) {
		const result = sh(`workspace_exec_command_for_package_manager ${packageManager} apps/refarm turbo run test`);

		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stdout, expected);
	}
});

test("shell package manager helper formats high severity audit commands", () => {
	const cases = [
		["pnpm", "pnpm audit --audit-level=high --silent"],
		["npm", "npm audit --audit-level=high --silent"],
		["yarn", "yarn npm audit --severity high"],
		["bun", "bun audit"],
	];

	for (const [packageManager, expected] of cases) {
		const result = sh(`audit_high_command_for_package_manager ${packageManager}`);

		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stdout, expected);
	}
});
