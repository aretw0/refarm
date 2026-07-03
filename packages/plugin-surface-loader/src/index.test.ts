import { REQUIRED_TOKENS, type DsTheme } from "@refarm.dev/ds";
import { createMockManifest } from "@refarm.dev/plugin-manifest";
import { describe, expect, it } from "vitest";
import {
	loadThemesFromManifest,
	PLUGIN_SURFACE_LOADER_CAPABILITY,
} from "./index.js";

function completeTheme(overrides: Partial<DsTheme> = {}): DsTheme {
	const theme = Object.fromEntries(
		REQUIRED_TOKENS.map((token) => [token, "#808080"]),
	) as DsTheme;
	return { ...theme, ...overrides };
}

function manifestWithThemePacks(
	surfaces: { id: string; assets: string[] }[],
) {
	return createMockManifest({
		extensions: {
			surfaces: surfaces.map((s) => ({
				layer: "asset",
				kind: "theme-pack",
				id: s.id,
				assets: s.assets,
			})),
		},
	});
}

describe("plugin-surface-loader", () => {
	it("exports the capability marker", () => {
		expect(PLUGIN_SURFACE_LOADER_CAPABILITY).toBe("plugin-surface-loader:v1");
	});

	it("registers a conformant plugin theme from the manifest", () => {
		const manifest = manifestWithThemePacks([
			{ id: "midnight", assets: ["./themes/midnight.json"] },
		]);
		const result = loadThemesFromManifest(manifest, () => ({
			theme: completeTheme({ primary: "#90b4e8" }),
		}));
		expect(result.registered).toEqual(["midnight"]);
		expect(result.rejected).toEqual([]);
	});

	it("rejects a token-incomplete plugin theme and reports missing tokens", () => {
		const manifest = manifestWithThemePacks([
			{ id: "broken", assets: ["./themes/broken.json"] },
		]);
		const result = loadThemesFromManifest(manifest, () => ({
			theme: { primary: "#fff" },
		}));
		expect(result.registered).toEqual([]);
		expect(result.rejected[0]?.id).toBe("broken");
		expect(result.rejected[0]?.missing.length).toBeGreaterThan(0);
	});

	it("ignores a manifest with no theme-pack surfaces", () => {
		const manifest = createMockManifest();
		const result = loadThemesFromManifest(manifest, () => ({}));
		expect(result.registered).toEqual([]);
		expect(result.results).toEqual([]);
	});

	it("loads multiple packs, registering only the conformant ones", () => {
		const manifest = manifestWithThemePacks([
			{ id: "good", assets: ["a.json"] },
			{ id: "bad", assets: ["b.json"] },
		]);
		const result = loadThemesFromManifest(manifest, (p) =>
			p === "a.json" ? { theme: completeTheme() } : { theme: { primary: "x" } },
		);
		expect(result.registered).toEqual(["good"]);
		expect(result.rejected.map((r) => r.id)).toEqual(["bad"]);
	});
});
