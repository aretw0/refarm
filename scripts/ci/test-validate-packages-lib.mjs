#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
	validateDsPublicApi,
	validatePackageManagerConfig,
	validatePublishSurface,
	validateRuntimeAgentPluginPackage,
	validateSiloPublicApi,
	validateWasmComponent,
	validateWitComponentDistributionTarget,
} from "../validate-packages.mjs";

test("allows root package manager config without legacy pnpm block", () => {
	assert.deepEqual(
		validatePackageManagerConfig({
			packageManager: "pnpm@11.7.0",
		}),
		[],
	);
});

test("rejects root package.json pnpm settings ignored by pnpm 11", () => {
	assert.deepEqual(
		validatePackageManagerConfig({
			packageManager: "pnpm@11.7.0",
			pnpm: {
				onlyBuiltDependencies: ["esbuild"],
			},
		}),
		[
			"package.json must not declare pnpm settings; use pnpm-workspace.yaml so pnpm 11 reads the effective workspace policy",
		],
	);
});

test("allows private packages without npm files allowlist", () => {
	assert.deepEqual(
		validatePublishSurface({
			private: true,
			publishConfig: { access: "public" },
		}),
		[],
	);
});

test("requires public packages to declare files allowlist", () => {
	assert.deepEqual(
		validatePublishSurface({
			publishConfig: { access: "public" },
		}),
		["public packages must declare a non-empty files allowlist"],
	);
});

test("rejects publish allowlist entries for local cache state", () => {
	assert.deepEqual(
		validatePublishSurface({
			publishConfig: { access: "public" },
			files: ["dist", ".turbo/turbo-build.log", "tsconfig.build.tsbuildinfo"],
		}),
		[
			'files entry ".turbo/turbo-build.log" must not include local cache/runtime state',
			'files entry "tsconfig.build.tsbuildinfo" must not include TypeScript incremental state',
		],
	);
});

test("requires public WASM component packages to expose typed import entry", () => {
	assert.deepEqual(
		validateWasmComponent("/tmp/does-not-exist", {
			publishConfig: { access: "public" },
			main: "./pkg/heartwood.js",
			types: "./pkg/heartwood.js",
			scripts: {
				"build:wasm": "cargo component build",
				"build:transpile": "jco transpile",
				build: "cargo component build && jco transpile",
			},
		}),
		[
			"Cargo.toml missing",
			"public WASM component packages must declare a .d.ts types entry",
			'public WASM component packages must declare exports["."] with "import" and "types" fields',
		],
	);
});

test("accepts public WASM component packages with explicit typed export", () => {
	assert.deepEqual(
		validateWasmComponent("/tmp/does-not-exist", {
			publishConfig: { access: "public" },
			main: "./pkg/heartwood.js",
			module: "./pkg/heartwood.js",
			types: "./pkg/heartwood.d.ts",
			exports: {
				".": {
					import: "./pkg/heartwood.js",
					types: "./pkg/heartwood.d.ts",
				},
			},
			scripts: {
				"build:wasm": "cargo component build",
				"build:transpile": "jco transpile",
				build: "cargo component build && jco transpile",
			},
		}).filter((issue) => issue !== "Cargo.toml missing"),
		[],
	);
});

test("accepts private runtime-agent plugin package candidate with explicit artifacts", () => {
	assert.deepEqual(
		validateRuntimeAgentPluginPackage({
			name: "@refarm.dev/pi-agent",
			private: true,
			files: ["dist/pi_agent.wasm", "dist/plugin.json", "dist/jco"],
			scripts: {
				"build:wasm":
					"pnpm run check:wit && copy wasm32-wasip1/release/pi_agent.wasm dist/pi_agent.wasm && write dist/plugin.json",
				"build:jco":
					"jco transpile dist/pi_agent.wasm --out-dir dist/jco",
			},
		}),
		[],
	);
});

test("rejects runtime-agent plugin publication without explicit artifact policy", () => {
	assert.deepEqual(
		validateRuntimeAgentPluginPackage({
			name: "@refarm.dev/pi-agent",
			private: false,
			files: ["dist"],
			scripts: {
				"build:wasm": "cargo component build",
				"build:jco": "jco transpile dist/pi_agent.wasm",
			},
		}),
		[
			'runtime-agent plugin package files must include "dist/pi_agent.wasm"',
			'runtime-agent plugin package files must include "dist/plugin.json"',
			'runtime-agent plugin package files must include "dist/jco"',
			'runtime-agent plugin package must declare publishConfig.access="public" before publication',
			'runtime-agent plugin build:wasm must run "check:wit" before building artifacts',
			'runtime-agent plugin build:wasm must write "dist/pi_agent.wasm"',
			'runtime-agent plugin build:wasm must write "dist/plugin.json"',
			'runtime-agent plugin build:jco must write "dist/jco"',
		],
	);
});

test("requires Silo public subpath exports for published SDK helpers", () => {
	assert.deepEqual(
		validateSiloPublicApi({
			name: "@refarm.dev/silo",
			exports: {
				".": {
					import: "./dist/index.js",
					types: "./dist/index.d.ts",
				},
			},
		}),
		[
			'silo public API must declare exports["./collect"]',
			'silo public API must declare exports["./key-manager"]',
		],
	);
});

test("accepts Silo public subpath exports for published SDK helpers", () => {
	assert.deepEqual(
		validateSiloPublicApi({
			name: "@refarm.dev/silo",
			exports: {
				"./collect": {
					import: "./dist/collect.js",
					types: "./dist/collect.d.ts",
				},
				"./key-manager": {
					import: "./dist/key-manager.js",
					types: "./dist/key-manager.d.ts",
				},
			},
		}),
		[],
	);
});

test("requires DS public subpath exports for published contract helpers", () => {
	assert.deepEqual(
		validateDsPublicApi({
			name: "@refarm.dev/ds",
			exports: {
				".": {
					import: "./dist/index.js",
					types: "./dist/index.d.ts",
				},
			},
		}),
		[
			'ds public API must declare exports["./contract"]',
			'ds public API must declare exports["./theme-conformance"]',
			'ds public API must declare exports["./html"]',
		],
	);
});

test("accepts DS public subpath exports for published contract helpers", () => {
	assert.deepEqual(
		validateDsPublicApi({
			name: "@refarm.dev/ds",
			exports: {
				"./contract": {
					import: "./dist/contract.js",
					types: "./dist/contract.d.ts",
				},
				"./theme-conformance": {
					import: "./dist/theme-conformance.js",
					types: "./dist/theme-conformance.d.ts",
				},
				"./html": {
					import: "./dist/html.js",
					types: "./dist/html.d.ts",
				},
			},
		}),
		[],
	);
});

test("accepts mapped WIT component distribution target", () => {
	assert.deepEqual(
		validateWitComponentDistributionTarget(
			{
				id: "agent-tools",
				cargoPackage: "refarm:agent-tools",
				targetPath: "wit",
				targetWorld: "agent-tools-provider",
				witPackage: "refarm:agent-tools@0.1.0",
				world: "agent-tools-provider",
				imports: ["host-spawn"],
				exports: ["agent-fs", "agent-shell", "structured-io"],
			},
			{
				cargoToml: `
[package.metadata.component]
package = "refarm:agent-tools"

[package.metadata.component.target]
path = "wit"
world = "agent-tools-provider"
`,
				wit: `
package refarm:agent-tools@0.1.0;

world agent-tools-provider {
    import host-spawn;
    export agent-fs;
    export agent-shell;
    export structured-io;
}
`,
			},
		),
		[],
	);
});

test("rejects unmapped WIT component distribution target", () => {
	assert.deepEqual(
		validateWitComponentDistributionTarget(
			{
				id: "refarm-plugin",
				cargoPackage: "refarm:plugin",
				targetPath: "wit",
				witPackage: "refarm:plugin@0.1.0",
				world: "refarm-plugin-host",
				imports: ["structured-io", "code-ops"],
				exports: ["integration"],
			},
			{
				cargoToml: `
[package.metadata.component]
package = "refarm:plugin"

[package.metadata.component.target]
path = "wit"
`,
				wit: `
package refarm:plugin@0.1.0;

world refarm-plugin-host {
    import structured-io;
    export integration;
}
`,
			},
		),
		["refarm-plugin WIT world must import code-ops"],
	);
});
