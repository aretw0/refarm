import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverVaultProviders } from "./vault-discovery.js";

describe("discoverVaultProviders", () => {
	let pluginsDir: string;
	beforeEach(() => {
		pluginsDir = mkdtempSync(join(tmpdir(), "vault-discovery-"));
	});
	afterEach(() => rmSync(pluginsDir, { recursive: true, force: true }));

	function writePlugin(id: string, manifest: unknown): void {
		const dir = join(pluginsDir, id);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "plugin.json"), JSON.stringify(manifest));
	}

	it("discovers a plugin advertising vault verbs, keeping its key and verbs", () => {
		writePlugin("@demo/vault-extract", {
			id: "@demo/vault-extract",
			capabilities: { provides: ["vault:search", "vault:extract"] },
		});
		const { providers } = discoverVaultProviders(pluginsDir);
		expect(providers).toHaveLength(1);
		expect(providers[0]).toMatchObject({
			pluginId: "@demo/vault-extract",
			pluginKey: "vault",
			verbs: ["search", "extract"],
			targets: ["vault:search", "vault:extract"],
		});
	});

	it("honors a custom pluginKey (notes:extract surfaces as a vault provider)", () => {
		writePlugin("@demo/notes", {
			id: "@demo/notes",
			capabilities: { provides: ["notes:extract", "notes:organize"] },
		});
		const { providers } = discoverVaultProviders(pluginsDir);
		expect(providers[0]).toMatchObject({
			pluginKey: "notes",
			verbs: ["extract", "organize"],
		});
	});

	it("ignores non-vault provides (a quality checker is not a vault provider)", () => {
		writePlugin("@demo/quality", {
			id: "@demo/quality",
			capabilities: { provides: ["quality:v1", "integration:respond"] },
		});
		expect(discoverVaultProviders(pluginsDir).providers).toEqual([]);
	});

	it("reads provides even when `entry` is a not-yet-installed template", () => {
		writePlugin("@demo/vault-extract", {
			id: "@demo/vault-extract",
			_note: "Entry injected at install time",
			capabilities: { provides: ["vault:extract"] },
		});
		expect(discoverVaultProviders(pluginsDir).providers[0]?.verbs).toEqual([
			"extract",
		]);
	});

	it("de-duplicates a verb advertised twice", () => {
		writePlugin("@demo/v", {
			id: "@demo/v",
			capabilities: { provides: ["vault:extract", "vault:extract"] },
		});
		expect(discoverVaultProviders(pluginsDir).providers[0]?.verbs).toEqual([
			"extract",
		]);
	});

	it("falls back to the directory name when id is absent", () => {
		writePlugin("@demo/anon", {
			capabilities: { provides: ["vault:search"] },
		});
		expect(discoverVaultProviders(pluginsDir).providers[0]?.pluginId).toBe(
			"anon",
		);
	});

	it("collects a malformed plugin.json into `rejected` without throwing", () => {
		const dir = join(pluginsDir, "@bad", "plugin");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "plugin.json"), "{ not json");
		const { providers, rejected } = discoverVaultProviders(pluginsDir);
		expect(providers).toEqual([]);
		expect(rejected).toContain("plugin");
	});

	it("returns empty when the plugins dir does not exist", () => {
		expect(discoverVaultProviders(join(pluginsDir, "nope"))).toEqual({
			providers: [],
			rejected: [],
		});
	});
});
