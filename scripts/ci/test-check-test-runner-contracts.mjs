#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	checkPackageScripts,
	nodeTestTargets,
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
});

test("detects Vitest source markers", () => {
	assert.equal(sourceUsesVitest('import { describe, it } from "vitest";'), true);
	assert.equal(sourceUsesVitest("/** @vitest-" + "environment jsdom */"), true);
	assert.equal(sourceUsesVitest('import test from "node:test";'), false);
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
