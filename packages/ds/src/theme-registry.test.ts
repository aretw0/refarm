import { describe, expect, it } from "vitest";
import { REQUIRED_TOKENS, type DsTheme } from "./contract.js";
import {
	registerThemePacks,
	resolveThemePacksFromSurfaces,
	ThemeRegistry,
	type ThemePackAsset,
	type ThemePackSurface,
} from "./theme-registry.js";

/** A complete, conformant theme: every required token set to a placeholder. */
function completeTheme(overrides: Partial<DsTheme> = {}): DsTheme {
	const theme = Object.fromEntries(
		REQUIRED_TOKENS.map((token) => [token, `value-${token}`]),
	) as DsTheme;
	return { ...theme, ...overrides };
}

describe("ThemeRegistry", () => {
	it("registers a conformant theme and resolves it by id", () => {
		const registry = new ThemeRegistry();
		const result = registry.register("midnight", completeTheme());
		expect(result).toEqual({ ok: true, id: "midnight", missing: [] });
		expect(registry.has("midnight")).toBe(true);
		expect(registry.get("midnight")?.theme.primary).toBe("value-primary");
		expect(registry.get("midnight")?.source).toBe("plugin");
	});

	it("rejects a theme missing required tokens and reports them", () => {
		const registry = new ThemeRegistry();
		const incomplete = completeTheme();
		delete (incomplete as Partial<DsTheme>).primary;
		delete (incomplete as Partial<DsTheme>).background;

		const result = registry.register("broken", incomplete);
		expect(result.ok).toBe(false);
		expect(result.missing).toEqual(expect.arrayContaining(["primary", "background"]));
		// Nothing was registered.
		expect(registry.has("broken")).toBe(false);
	});

	it("is a name guard: an unknown theme is not present", () => {
		const registry = new ThemeRegistry();
		expect(registry.has("never-registered")).toBe(false);
		expect(registry.get("never-registered")).toBeUndefined();
	});

	it("rejects a duplicate id without overwriting", () => {
		const registry = new ThemeRegistry();
		registry.register("dup", completeTheme({ primary: "first" }));
		const second = registry.register("dup", completeTheme({ primary: "second" }));
		expect(second.ok).toBe(false);
		expect(second.missing).toEqual(["<duplicate-id>"]);
		expect(registry.get("dup")?.theme.primary).toBe("first");
	});

	it("rejects an empty id", () => {
		const registry = new ThemeRegistry();
		expect(registry.register("  ", completeTheme()).ok).toBe(false);
	});

	it("registerThemePacks gates each pack by conformance", () => {
		const registry = new ThemeRegistry();
		const packs: ThemePackAsset[] = [
			{ id: "good", theme: completeTheme() },
			{ id: "bad", theme: { primary: "only-one-token" } },
		];
		const results = registerThemePacks(registry, packs);
		expect(results[0]).toMatchObject({ ok: true, id: "good" });
		expect(results[1]?.ok).toBe(false);
		expect(registry.ids()).toEqual(["good"]);
	});
});

describe("resolveThemePacksFromSurfaces", () => {
	const surfaces: ThemePackSurface[] = [
		{ kind: "theme-pack", id: "midnight", assets: ["./themes/midnight.json"] },
		{ kind: "panel", id: "not-a-theme", assets: ["./x.json"] }, // ignored
	];

	it("loads theme-pack assets and ignores other surface kinds", () => {
		const packs = resolveThemePacksFromSurfaces(surfaces, () => ({
			theme: completeTheme(),
		}));
		expect(packs).toHaveLength(1);
		expect(packs[0]?.id).toBe("midnight");
		expect(packs[0]?.theme.primary).toBe("value-primary");
	});

	it("prefers an asset's own id over the surface id", () => {
		const packs = resolveThemePacksFromSurfaces(surfaces, () => ({
			id: "asset-chosen",
			theme: completeTheme(),
		}));
		expect(packs[0]?.id).toBe("asset-chosen");
	});

	it("accepts `tokens` as an alias for `theme`", () => {
		const packs = resolveThemePacksFromSurfaces(surfaces, () => ({
			tokens: completeTheme(),
		}));
		expect(packs).toHaveLength(1);
	});

	it("skips an asset that fails to load without crashing", () => {
		const packs = resolveThemePacksFromSurfaces(surfaces, () => {
			throw new Error("ENOENT");
		});
		expect(packs).toEqual([]);
	});

	it("skips a payload with no token map", () => {
		const packs = resolveThemePacksFromSurfaces(surfaces, () => ({ notTheme: 1 }));
		expect(packs).toEqual([]);
	});

	it("end to end: resolve → register gates by conformance", () => {
		const registry = new ThemeRegistry();
		const packs = resolveThemePacksFromSurfaces(
			[
				{ kind: "theme-pack", id: "ok", assets: ["a.json"] },
				{ kind: "theme-pack", id: "bad", assets: ["b.json"] },
			],
			(p) => (p === "a.json" ? { theme: completeTheme() } : { theme: { primary: "x" } }),
		);
		const results = registerThemePacks(registry, packs);
		expect(results.map((r) => r.ok)).toEqual([true, false]);
		expect(registry.ids()).toEqual(["ok"]);
	});
});
