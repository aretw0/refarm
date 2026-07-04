import {
	detectEntryFormat,
	validatePluginManifest,
} from "@refarm.dev/plugin-manifest";
import { describe, expect, it } from "vitest";

import {
	buildVaultPluginManifest,
	VAULT_ENTRY_PLACEHOLDER,
	vaultProvides,
} from "./manifest.js";

// A well-formed placeholder digest — the §8 install replaces it with the real
// SHA-256 of the built .wasm. Shape only: sha256- + 64 hex.
const PLACEHOLDER_INTEGRITY = `sha256-${"0".repeat(64)}`;

describe("vaultProvides — the advertised verbs", () => {
	it("advertises <pluginKey>:<verb> for all four verbs", () => {
		expect(vaultProvides("vault")).toEqual([
			"vault:search",
			"vault:extract",
			"vault:organize",
			"vault:profile",
		]);
	});
});

describe("buildVaultPluginManifest — the DECLARATION half", () => {
	it("declares the vault verbs and a .wasm entry", () => {
		const manifest = buildVaultPluginManifest({ id: "@demo/vault-extract" });
		expect(manifest.id).toBe("@demo/vault-extract");
		expect(manifest.entry).toBe(VAULT_ENTRY_PLACEHOLDER);
		expect(detectEntryFormat(manifest.entry)).toBe("wasm");
		expect(manifest.capabilities.provides).toEqual([
			"vault:search",
			"vault:extract",
			"vault:organize",
			"vault:profile",
		]);
	});

	it("is DELIBERATELY invalid until §8 supplies integrity (a real build requirement)", () => {
		const foundation = buildVaultPluginManifest({ id: "@demo/vault-extract" });
		const result = validatePluginManifest(foundation);
		expect(result.valid).toBe(false);
		expect(result.errors).toContain("integrity is required for .wasm entries");
		// It is invalid ONLY for the missing integrity — every other field is ready.
		expect(result.errors).toEqual(["integrity is required for .wasm entries"]);
	});

	it("becomes VALID once integrity is stamped — the §8 install is just this swap", () => {
		const installReady = buildVaultPluginManifest({
			id: "@demo/vault-extract",
			integrity: PLACEHOLDER_INTEGRITY,
		});
		const result = validatePluginManifest(installReady);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});

	it("a custom pluginKey re-scopes the provides targets", () => {
		const manifest = buildVaultPluginManifest({
			id: "@demo/notes",
			pluginKey: "notes",
			integrity: PLACEHOLDER_INTEGRITY,
		});
		expect(manifest.capabilities.provides).toEqual([
			"notes:search",
			"notes:extract",
			"notes:organize",
			"notes:profile",
		]);
		expect(validatePluginManifest(manifest).valid).toBe(true);
	});
});
