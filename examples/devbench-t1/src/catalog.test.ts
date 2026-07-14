import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { catalogPlugins, runCatalog } from "./live-catalog.js";
import { buildRegistry } from "./cli.js";

/**
 * plugin-catalog installs the real built plugins through the Barn (fetch + sha256 verify + cache)
 * and lists the sovereign inventory. It runs OFFLINE (a file:// fetch, no daemon), so it needs no
 * RUN_RUNTIME_EXECUTION gate — but it does need the built .wasm on disk, so it skips gracefully
 * when they are absent (a fresh checkout before a build).
 */

const artifactsReady = catalogPlugins().every((p) => existsSync(p.path));

describe("plugin-catalog — the Barn's verified inventory", () => {
	it("is mounted with an IDE command + web route", () => {
		const verb = buildRegistry().get("plugin-catalog");
		if (!verb || "actions" in verb) throw new Error("plugin-catalog not mounted");
		expect(verb.renderers?.web?.route).toBe("/plugin-catalog");
		expect((verb.renderers?.ide as { command?: string } | undefined)?.command).toBe("dgk.plugin-catalog");
	});

	it.skipIf(!artifactsReady)("installs the built plugins + lists them, with a cache hit on re-install", async () => {
		const report = await runCatalog();
		// Every built plugin is in the inventory, verified (integrity) + fingerprinted (wasmHash).
		expect(report.installed.length).toBe(catalogPlugins().length);
		for (const entry of report.installed) {
			expect(entry.integrity).toMatch(/^sha256-/);
			expect(entry.wasmHash).toBeTruthy();
			expect(entry.status).toBe("installed");
		}
		// The content cache dedups: re-installing the same bytes is a hit.
		expect(report.reinstallCacheStatus).toBe("hit");
		// The three distinct plugins are present.
		expect(report.installed.map((e) => e.name).sort()).toEqual(["agent", "delegate", "source-provider"]);
	});

	it.skipIf(!artifactsReady)("the plugin-catalog VERB reports the inventory", async () => {
		const verb = buildRegistry().get("plugin-catalog");
		if (!verb || "actions" in verb) throw new Error("plugin-catalog not mounted");
		const env = (await verb.run({ args: {}, options: {}, json: true })) as unknown as {
			ok: boolean;
			count: number;
			catalog: Array<{ integrity: string; wasmHash: string }>;
			reinstallCacheStatus: string;
		};
		expect(env.ok).toBe(true);
		expect(env.count).toBe(3);
		expect(env.catalog.every((e) => e.integrity.startsWith("sha256-") && e.wasmHash)).toBe(true);
		expect(env.reinstallCacheStatus).toBe("hit");
	});
});
