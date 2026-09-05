import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	buildArchitectureInventory,
	renderArchitectureInventoryMarkdown,
} from "./lib/architecture-inventory.mjs";

function createWorkspace(root, path, pkg, files = {}) {
	const directory = join(root, path);
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
	for (const [relativePath, contents] of Object.entries(files)) {
		const file = join(directory, relativePath);
		mkdirSync(join(file, ".."), { recursive: true });
		writeFileSync(file, contents);
	}
}

test("inventory derives languages, counts, and an acyclic app-to-package graph", () => {
	const root = mkdtempSync(join(tmpdir(), "refarm-architecture-inventory-"));
	try {
		createWorkspace(root, "packages/kernel", { name: "@example/kernel" }, {
			"Cargo.toml": "[package]\nname = \"kernel\"\n\n[package.metadata.component.target]\npath = \"../plugin-wit/wit\"\n",
			"src/lib.rs": "pub fn run() {}\n",
		});
		const witDirectory = join(root, "packages/plugin-wit");
		mkdirSync(join(witDirectory, "src"), { recursive: true });
		mkdirSync(join(witDirectory, "wit"), { recursive: true });
		writeFileSync(join(witDirectory, "Cargo.toml"), "[package]\nname = \"plugin-wit\"\n");
		writeFileSync(join(witDirectory, "src/lib.rs"), "pub const VERSION: u8 = 1;\n");
		writeFileSync(join(witDirectory, "wit/host.wit"), "package example:host;\n");
		createWorkspace(root, "packages/task-contract-v1", { name: "@example/task-contract-v1" }, {
			"src/index.ts": "export type Task = {};\n",
		});
		createWorkspace(root, "apps/cli", {
			name: "@example/cli",
			dependencies: { "@example/kernel": "workspace:*", "@example/task-contract-v1": "workspace:*" },
		}, { "src/index.ts": "export {};\n" });

		const report = buildArchitectureInventory({ root });
		assert.equal(report.ok, true);
		assert.deepEqual(report.summary, {
			workspaces: 4,
			apps: 1,
			packages: 3,
			contracts: 1,
			byLanguageProfile: {
				Rust: 1,
				"Rust + WIT": 1,
				TypeScript: 2,
			},
		});
		assert.deepEqual(
			report.workspaces.find((workspace) => workspace.name === "@example/kernel")?.internalDependencies,
			["plugin-wit"],
		);
		assert.deepEqual(
			report.workspaces.find((workspace) => workspace.name === "@example/kernel")?.internalDependencyScopes,
			{ "plugin-wit": ["cargo-path"] },
		);
		assert.deepEqual(report.invariants.cycles, []);
		assert.deepEqual(report.invariants.packageToApp, []);
		assert.match(renderArchitectureInventoryMarkdown(report), /Internal dependency graph is acyclic: pass/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("inventory rejects package-to-app dependencies and cycles deterministically", () => {
	const root = mkdtempSync(join(tmpdir(), "refarm-architecture-inventory-invalid-"));
	try {
		createWorkspace(root, "apps/host", {
			name: "@example/host",
			dependencies: { "@example/a": "workspace:*" },
		});
		createWorkspace(root, "packages/a", {
			name: "@example/a",
			devDependencies: { "@example/host": "workspace:*" },
		});

		const first = buildArchitectureInventory({ root });
		const second = buildArchitectureInventory({ root });
		assert.deepEqual(first, second);
		assert.equal(first.ok, false);
		assert.deepEqual(first.invariants.packageToApp, [{ from: "@example/a", to: "@example/host" }]);
		assert.deepEqual(first.invariants.cycles, [["@example/a", "@example/host"]]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
