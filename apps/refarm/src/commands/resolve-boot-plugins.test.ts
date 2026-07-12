import { describe, expect, it } from "vitest";

import type { RefarmCliConfig } from "./config-shared.js";
import { resolveBootPluginPaths } from "./resolve-boot-plugins.js";

/**
 * A fake filesystem for the resolver: a map of dir → children and a map of
 * manifest path → `{id}`. Every install dir is assumed to hold a `plugin.wasm`
 * alongside its `plugin.json`. Lets the resolver run with zero disk.
 */
function fakeFs(layout: {
	/** plugins base dir → list of top-level entries (dirs). */
	tree: Record<string, string[]>;
	/** install-dir (relative to base) → manifest id (its `plugin.json.id`). */
	manifests: Record<string, string>;
	base: string;
}) {
	const dirs = new Set(Object.keys(layout.tree));
	// Every dir that has a manifest also exists as a directory.
	for (const rel of Object.keys(layout.manifests)) dirs.add(`${layout.base}/${rel}`);
	dirs.add(layout.base);

	const manifestPaths = new Map<string, string>();
	const wasmPaths = new Set<string>();
	for (const [rel, id] of Object.entries(layout.manifests)) {
		manifestPaths.set(`${layout.base}/${rel}/plugin.json`, JSON.stringify({ id }));
		wasmPaths.add(`${layout.base}/${rel}/plugin.wasm`);
	}

	return {
		existsSync: ((p: string) =>
			manifestPaths.has(String(p)) ||
			wasmPaths.has(String(p)) ||
			dirs.has(String(p))) as unknown as typeof import("node:fs").existsSync,
		readdirSync: ((p: string) =>
			layout.tree[String(p)] ?? []) as unknown as typeof import("node:fs").readdirSync,
		statSync: ((p: string) => ({
			isDirectory: () => dirs.has(String(p)),
		})) as unknown as typeof import("node:fs").statSync,
		readFileSync: ((p: string) => {
			const m = manifestPaths.get(String(p));
			if (m === undefined) throw new Error(`ENOENT ${p}`);
			return m;
		}) as unknown as typeof import("node:fs").readFileSync,
	};
}

const BASE = "/home/x/.refarm/plugins";

function run(config: RefarmCliConfig, layout: Parameters<typeof fakeFs>[0]) {
	return resolveBootPluginPaths(BASE, config, fakeFs(layout));
}

describe("resolveBootPluginPaths — boot list = installed ∩ trusted, minus agent", () => {
	it("loads an installed + trusted plugin", () => {
		const paths = run(
			{ trusted_plugins: ["agent", "delegate"] },
			{
				base: BASE,
				tree: { [BASE]: ["refarm_delegate"] },
				manifests: { refarm_delegate: "@refarm/delegate" },
			},
		);
		expect(paths).toEqual([`${BASE}/refarm_delegate/plugin.wasm`]);
	});

	it("EXCLUDES the agent even when trusted (the start script loads it separately)", () => {
		const paths = run(
			{ trusted_plugins: ["agent", "delegate"] },
			{
				base: BASE,
				tree: { [BASE]: ["@refarm", "refarm_delegate"] },
				manifests: { "@refarm/agent": "@refarm/agent", refarm_delegate: "@refarm/delegate" },
			},
		);
		expect(paths).toEqual([`${BASE}/refarm_delegate/plugin.wasm`]);
	});

	it("SKIPS an installed-but-untrusted plugin (Strict would reject it)", () => {
		const paths = run(
			{ trusted_plugins: ["agent", "delegate"] },
			{
				base: BASE,
				tree: { [BASE]: ["refarm_delegate", "example_gated"] },
				manifests: { refarm_delegate: "@refarm/delegate", example_gated: "@example/gated" },
			},
		);
		expect(paths).toEqual([`${BASE}/refarm_delegate/plugin.wasm`]);
	});

	it("de-duplicates two install dirs that resolve to the same runtime id", () => {
		const paths = run(
			{ trusted_plugins: ["quality"] },
			{
				base: BASE,
				// two dirs, both id @refarm/quality → runtime id `quality`
				tree: { [BASE]: ["refarm_quality", "quality_copy"] },
				manifests: { refarm_quality: "@refarm/quality", quality_copy: "@refarm/quality" },
			},
		);
		expect(paths).toHaveLength(1);
	});

	it("the * wildcard loads every installed plugin (still minus the agent)", () => {
		const paths = run(
			{ trusted_plugins: ["*"] },
			{
				base: BASE,
				tree: { [BASE]: ["@refarm", "refarm_delegate", "example_gated"] },
				manifests: {
					"@refarm/agent": "@refarm/agent",
					refarm_delegate: "@refarm/delegate",
					example_gated: "@example/gated",
				},
			},
		);
		expect(paths.sort()).toEqual(
			[`${BASE}/example_gated/plugin.wasm`, `${BASE}/refarm_delegate/plugin.wasm`].sort(),
		);
	});

	it("finds a scoped install dir nested under a scope dir (@refarm/agent style)", () => {
		const paths = run(
			{ trusted_plugins: ["delegate"] },
			{
				base: BASE,
				tree: { [BASE]: ["@refarm"], [`${BASE}/@refarm`]: ["delegate"] },
				manifests: { "@refarm/delegate": "@refarm/delegate" },
			},
		);
		expect(paths).toEqual([`${BASE}/@refarm/delegate/plugin.wasm`]);
	});

	it("returns [] when there is no allowlist (Strict trusts nothing extra)", () => {
		const paths = run(
			{},
			{ base: BASE, tree: { [BASE]: ["refarm_delegate"] }, manifests: { refarm_delegate: "@refarm/delegate" } },
		);
		expect(paths).toEqual([]);
	});

	it("returns [] when the plugins dir does not exist", () => {
		const paths = resolveBootPluginPaths(
			"/nope",
			{ trusted_plugins: ["delegate"] },
			fakeFs({ base: BASE, tree: {}, manifests: {} }),
		);
		expect(paths).toEqual([]);
	});

	it("skips a dir with a manifest but no wasm (not loadable)", () => {
		// manifest present, but we drop the wasm from the fake fs by overriding existsSync
		const fs = fakeFs({
			base: BASE,
			tree: { [BASE]: ["refarm_delegate"] },
			manifests: { refarm_delegate: "@refarm/delegate" },
		});
		const noWasm = {
			...fs,
			existsSync: ((p: string) =>
				String(p).endsWith("plugin.wasm")
					? false
					: (fs.existsSync as (x: string) => boolean)(String(p))) as typeof fs.existsSync,
		};
		const paths = resolveBootPluginPaths(BASE, { trusted_plugins: ["delegate"] }, noWasm);
		expect(paths).toEqual([]);
	});
});
