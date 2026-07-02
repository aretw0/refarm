#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	checkAppsRefarmScripts,
	checkPackageScripts,
	checkReleaseReadinessTestScript,
	nodeTestTargets,
	sourceUsesNestedSpawnSync,
	sourceUsesVitest,
} from "./check-test-runner-contracts.mjs";

function withTempWorkspace(callback) {
	const root = mkdtempSync(path.join(tmpdir(), "refarm-test-runner-contracts-"));
	try {
		return callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("extracts node --test targets from package scripts", () => {
	assert.deepEqual(
		nodeTestTargets("node --test scripts/ci/a.mjs && node --test scripts/ci/b.mjs"),
		["scripts/ci/a.mjs", "scripts/ci/b.mjs"],
	);
	assert.deepEqual(
		nodeTestTargets("node --test --test-concurrency=1 scripts/ci/a.mjs scripts/ci/b.mjs && node --test codemods/c.mjs"),
		["scripts/ci/a.mjs", "scripts/ci/b.mjs", "codemods/c.mjs"],
	);
});

test("detects Vitest source markers", () => {
	assert.equal(sourceUsesVitest('import { describe, it } from "vitest";'), true);
	assert.equal(sourceUsesVitest("/** @vitest-" + "environment jsdom */"), true);
	assert.equal(sourceUsesVitest('import test from "node:test";'), false);
});

test("detects synchronous nested child process calls", () => {
	assert.equal(sourceUsesNestedSpawnSync('import { execFileSync } from "node:child_process";\n'), true);
	assert.equal(sourceUsesNestedSpawnSync("spawnSync(process.execPath, []);\n"), true);
	assert.equal(sourceUsesNestedSpawnSync('import { spawn } from "node:child_process";\n'), false);
});

test("allows node --test scripts backed by node:test", () => {
	withTempWorkspace((root) => {
		mkdirSync(path.join(root, "scripts", "ci"), { recursive: true });
		writeFileSync(
			path.join(root, "scripts", "ci", "node-suite.mjs"),
			'import test from "node:test";\n',
		);

		assert.deepEqual(
			checkPackageScripts({
				scripts: {
					"node-suite:test": "node --test scripts/ci/node-suite.mjs",
				},
			}, { root }),
			[],
		);
	});
});

test("rejects node --test scripts backed by Vitest files", () => {
	withTempWorkspace((root) => {
		mkdirSync(path.join(root, "packages", "toolbox", "test"), { recursive: true });
		writeFileSync(
			path.join(root, "packages", "toolbox", "test", "package-manager.test.js"),
			'import { describe, it } from "vitest";\n',
		);

		assert.deepEqual(
			checkPackageScripts({
				scripts: {
					"toolbox:test": "node --test packages/toolbox/test/package-manager.test.js",
				},
			}, { root }),
			[
				{
					script: "toolbox:test",
					target: "packages/toolbox/test/package-manager.test.js",
					message: "toolbox:test runs packages/toolbox/test/package-manager.test.js with node --test, but the file uses Vitest.",
				},
			],
		);
	});
});

test("rejects apps/refarm test:focused because it looks cheaper than it is", () => {
	assert.deepEqual(
		checkAppsRefarmScripts({
			scripts: {
				"test:focused": "vitest run --maxWorkers=1",
			},
		}),
		[
			{
				script: "test:focused",
				target: "apps/refarm/package.json",
				message:
					"apps/refarm must not expose test:focused; use test:file or named scripts so agents do not treat app Vitest as a cheap generic gate.",
			},
		],
	);
	assert.deepEqual(
		checkAppsRefarmScripts({
			scripts: {
				"test:file": "vitest run --maxWorkers=1",
			},
		}),
		[],
	);
});

test("rejects release readiness tests that spawn nested synchronous processes", () => {
	withTempWorkspace((root) => {
		mkdirSync(path.join(root, "scripts", "ci"), { recursive: true });
		writeFileSync(
			path.join(root, "scripts", "ci", "safe.mjs"),
			'import test from "node:test";\n',
		);
		writeFileSync(
			path.join(root, "scripts", "ci", "unsafe.mjs"),
			'import { execFileSync } from "node:child_process";\n',
		);

		assert.deepEqual(
			checkReleaseReadinessTestScript({
				scripts: {
					"release:readiness:test": "node --test scripts/ci/safe.mjs scripts/ci/unsafe.mjs",
				},
			}, { root }),
			[
				{
					script: "release:readiness:test",
					target: "scripts/ci/unsafe.mjs",
					message:
						"release:readiness:test must not run tests that use execFileSync/spawnSync; expose importable helpers so the gate works inside managed agent sandboxes.",
				},
			],
		);
	});
});
