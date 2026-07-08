#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildScaffoldInventory } from "./lib/scaffold-inventory.mjs";

function writeJson(path, value) {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(path, contents = "") {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, contents);
}

test("scaffold inventory classifies covered packages and missing workspace generators", () => {
	const root = mkdtempSync(join(tmpdir(), "refarm-scaffold-inventory-"));
	try {
		writeJson(join(root, "packages/capability-host/package.json"), {
			name: "@refarm.dev/capability-host",
			type: "module",
			main: "./dist/index.js",
			exports: {
				".": {
					import: "./dist/index.js",
					types: "./dist/index.d.ts",
				},
			},
			scripts: { build: "tsc --project tsconfig.build.json" },
		});

		writeJson(join(root, "examples/wallet-t2/package.json"), {
			name: "wallet-t2",
			private: true,
			type: "module",
			bin: { dgk: "./dist/cli.js" },
			scripts: {
				build: "tsc --project tsconfig.build.json",
				typeCheck: "tsc --noEmit",
				test: "vitest run",
				dgk: "node dist/cli.js",
			},
			dependencies: {
				"@refarm.dev/capability-host": "workspace:*",
				"@refarm.dev/capabilities-v1": "workspace:*",
			},
		});
		writeJson(join(root, "apps/farmhand/package.json"), {
			name: "@refarm.dev/farmhand",
			type: "module",
			scripts: {
				start: "node dist/index.js",
			},
			dependencies: {
				"@refarm.dev/stream-contract-v1": "workspace:*",
			},
		});
		writeFile(join(root, "apps/farmhand/src/index.ts"));

		writeFile(join(root, "validations/wallet-poc/wallet-poc.mjs"));
		writeFile(join(root, "validations/wallet-poc/wallet-poc.test.mjs"));
		writeFile(join(root, "validations/fixture-poc/fixture-poc.mjs"));
		writeFile(join(root, "validations/fixture-poc/fixture-poc.test.mjs"));
		writeFile(join(root, "validations/fixture-poc/fixtures/expected/scorecard.json"), "{}");
		writeFile(join(root, "validations/fixture-poc/fixtures/expected/task-artifacts.json"), "{}");
		writeFile(join(root, "validations/substrate-probe/run-probe.mjs"));
		writeFile(join(root, "validations/substrate-probe/probe.test.mjs"));
		writeFile(join(root, "validations/substrate-probe/probe.rs"));
		writeJson(join(root, "validations/simple-workspace/package.json"), {
			name: "simple-workspace",
			type: "module",
			scripts: {
				test: "vitest run",
			},
		});
		writeJson(join(root, "templates/workspace/refarm.template.json"), {
			schemaVersion: 1,
			id: "workspace",
			source: "typescript",
			config: {
				type: "app",
			},
		});
		writeFile(join(root, "templates/workspace/typescript/README.md"));
		writeFile(join(root, "templates/rust-plugin/.turbo/turbo-build.log"));

		const report = buildScaffoldInventory({ root });
		const byPath = Object.fromEntries(report.items.map((item) => [item.path, item]));

		assert.equal(report.schemaVersion, 1);
		assert.equal(byPath["packages/capability-host"].archetype, "package/buildable");
		assert.equal(byPath["packages/capability-host"].status, "covered");
		assert.equal(byPath["packages/capability-host"].expectedGenerator, "turbo gen package");

		assert.equal(byPath["examples/wallet-t2"].archetype, "example/dgk-workbench");
		assert.equal(byPath["examples/wallet-t2"].status, "covered");
		assert.equal(byPath["examples/wallet-t2"].expectedGenerator, "turbo gen example");

		assert.equal(byPath["apps/farmhand"].archetype, "app/service");
		assert.equal(byPath["apps/farmhand"].status, "covered");
		assert.equal(byPath["apps/farmhand"].expectedGenerator, "turbo gen app");

		assert.equal(byPath["validations/wallet-poc"].archetype, "validation/poc-script");
		assert.equal(byPath["validations/wallet-poc"].status, "covered");
		assert.equal(byPath["validations/wallet-poc"].expectedGenerator, "turbo gen validation");
		assert.equal(byPath["validations/fixture-poc"].archetype, "validation/fixture-poc-script");
		assert.equal(byPath["validations/fixture-poc"].status, "covered");
		assert.equal(byPath["validations/substrate-probe"].archetype, "validation/substrate-probe");
		assert.equal(byPath["validations/substrate-probe"].status, "covered");
		assert.equal(byPath["validations/simple-workspace"].archetype, "validation/workspace");

		assert.equal(byPath["templates/rust-plugin"].archetype, "template/sower");
		assert.deepEqual(byPath["templates/rust-plugin"].findings, []);
		assert.equal(byPath["templates/workspace"].archetype, "template/sower-manifest");
		assert.equal(byPath["templates/workspace"].status, "covered");
		assert.equal(byPath["templates/workspace"].expectedGenerator, "refarm scaffold template");

		assert.equal(report.summary.byStatus.covered, 7);
		assert.equal(report.summary.byStatus["needs-generator"], 1);
		assert.equal(report.summary.byStatus["parallel-factory"], 1);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("scaffold inventory command emits a stable JSON envelope", () => {
	const result = spawnSync(process.execPath, ["scripts/ci/check-scaffold-inventory.mjs", "--json"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});

	assert.equal(result.status, 0);
	assert.equal(result.stderr, "");

	const output = JSON.parse(result.stdout);
	assert.equal(output.schemaVersion, 1);
	assert.equal(output.command, "scaffold-inventory");
	assert.equal(output.operation, "inventory");
	assert.equal(output.ok, true);
	assert.ok(output.summary.total > 0);
	assert.ok(Array.isArray(output.items));
	assert.ok(output.items.some((item) => item.path === "examples/wallet-t2" && item.archetype === "example/dgk-workbench"));
});

test("scaffold inventory strict mode allows skipped local template cache", () => {
	const root = mkdtempSync(join(tmpdir(), "refarm-scaffold-inventory-strict-"));
	try {
		writeJson(join(root, "templates/rust-plugin/refarm.template.json"), {
			schemaVersion: 1,
			id: "rust-plugin",
			source: ".",
			config: {
				type: "plugin",
			},
		});
		writeFile(join(root, "templates/rust-plugin/.turbo/turbo-build.log"));

		const result = spawnSync(
			process.execPath,
			[
				"scripts/ci/check-scaffold-inventory.mjs",
				"--root",
				root,
				"--strict",
				"--json",
			],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			},
		);

		assert.equal(result.status, 0);
		assert.equal(result.stderr, "");
		const output = JSON.parse(result.stdout);
		assert.equal(output.ok, true);
		assert.deepEqual(output.blockingItems, []);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});

test("scaffold inventory strict mode fails on template artifacts that scaffold would copy", () => {
	const root = mkdtempSync(join(tmpdir(), "refarm-scaffold-inventory-strict-"));
	try {
		writeJson(join(root, "templates/rust-plugin/refarm.template.json"), {
			schemaVersion: 1,
			id: "rust-plugin",
			source: ".",
			config: {
				type: "plugin",
			},
		});
		writeFile(join(root, "templates/rust-plugin/target/debug/build.log"));

		const result = spawnSync(
			process.execPath,
			[
				"scripts/ci/check-scaffold-inventory.mjs",
				"--root",
				root,
				"--strict",
				"--json",
			],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			},
		);

		assert.equal(result.status, 1);
		assert.equal(result.stderr, "");
		const output = JSON.parse(result.stdout);
		assert.equal(output.ok, false);
		assert.deepEqual(output.blockingItems, [
			{
				path: "templates/rust-plugin",
				archetype: "template/sower-manifest",
				status: "parallel-factory",
				findings: [
					{
						id: "copied-artifact-in-template",
						severity: "warning",
						path: "templates/rust-plugin/target/debug/build.log",
						summary: "Template contains build/cache output that scaffold copy would include.",
					},
				],
			},
		]);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});
