import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES } from "./builtin-themes.generated.js";
import { runDsThemeConformance } from "./theme-conformance.js";
import { ThemeRegistry } from "./theme-registry.js";
import { projectThemeToTui } from "./theme-tui.js";
import { dtcgToDsTheme, type DtcgTokenFile } from "./tokens-source.js";

function loadTokens(fileName: string): DtcgTokenFile {
	return JSON.parse(
		readFileSync(fileURLToPath(new URL(`./tokens/${fileName}`, import.meta.url)), "utf8"),
	) as DtcgTokenFile;
}

const BUILTIN_IDS = Object.keys(BUILTIN_THEMES);

describe("BUILTIN_THEMES — built-ins as surface-neutral DsTheme objects from the DTCG source", () => {
	it("ships all four built-in themes", () => {
		expect(BUILTIN_IDS.sort()).toEqual(["oceano", "terracota", "tractor-green", "verde-jardim"]);
	});

	it.each(BUILTIN_IDS)("%s is contract-conformant AND matches its DTCG source (regenerate if stale)", (id) => {
		expect(runDsThemeConformance(BUILTIN_THEMES[id]!).pass).toBe(true);
		// The drift guard: the generated object must equal the freshly-flattened DTCG base. If this fails,
		// the generated module is stale — run `pnpm -C packages/ds run generate`.
		expect(BUILTIN_THEMES[id]).toEqual(dtcgToDsTheme(loadTokens(`${id}.tokens.json`)));
	});

	it("the multi-surface dividend: a built-in reaches the TERMINAL from the DTCG source (no CSS regex)", () => {
		const tui = projectThemeToTui(BUILTIN_THEMES["verde-jardim"]!);
		// verde-jardim's base (dark) primary #95d5b2, downsampled to the terminal representations.
		expect(tui.primary?.hex).toBe("#95d5b2");
		expect(tui.primary?.ansi256).toBeTypeOf("number");
		expect(tui.primary?.ansi16).toBeTypeOf("number");
		// Non-color tokens (radius/shadow/font) have no terminal analogue and are absent.
		expect(Object.keys(tui)).not.toContain("radius-md");
	});

	it("registers every built-in into a ThemeRegistry as a conformance-gated 'built-in' source", () => {
		const registry = new ThemeRegistry();
		for (const id of BUILTIN_IDS) {
			expect(registry.register(id, BUILTIN_THEMES[id]!, "built-in").ok).toBe(true);
		}
		expect(registry.ids().sort()).toEqual(["oceano", "terracota", "tractor-green", "verde-jardim"]);
		expect(registry.get("tractor-green")?.source).toBe("built-in");
	});
});
