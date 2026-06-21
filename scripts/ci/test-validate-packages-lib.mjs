#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { validatePackageManagerConfig, validatePublishSurface } from "../validate-packages.mjs";

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
