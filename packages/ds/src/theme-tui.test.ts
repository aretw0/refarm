import { describe, expect, it } from "vitest";
import { REQUIRED_TOKENS, type DsTheme } from "./contract.js";
import {
	parseColorToRgb,
	projectThemeToTui,
	rgbToAnsi16,
	rgbToAnsi256,
	TUI_COLOR_TOKENS,
} from "./theme-tui.js";

function completeTheme(overrides: Partial<DsTheme> = {}): DsTheme {
	const theme = Object.fromEntries(
		REQUIRED_TOKENS.map((token) => [token, "#808080"]),
	) as DsTheme;
	return { ...theme, ...overrides };
}

describe("parseColorToRgb", () => {
	it("parses #rrggbb", () => {
		expect(parseColorToRgb("#0f1623")).toEqual({ r: 15, g: 22, b: 35 });
	});
	it("parses #rgb shorthand", () => {
		expect(parseColorToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
	});
	it("parses rgb()/rgba()", () => {
		expect(parseColorToRgb("rgb(16, 32, 48)")).toEqual({ r: 16, g: 32, b: 48 });
		expect(parseColorToRgb("rgba(1,2,3,0.5)")).toEqual({ r: 1, g: 2, b: 3 });
	});
	it("returns null for unsupported forms (hsl/oklch/color-mix)", () => {
		expect(parseColorToRgb("hsl(210 40% 20%)")).toBeNull();
		expect(parseColorToRgb("oklch(0.2 0.1 250)")).toBeNull();
		expect(parseColorToRgb("color-mix(in srgb, red, blue)")).toBeNull();
	});
});

describe("rgb downsampling", () => {
	it("maps pure colors to the 256 cube", () => {
		expect(rgbToAnsi256({ r: 255, g: 0, b: 0 })).toBe(196);
		expect(rgbToAnsi256({ r: 0, g: 0, b: 0 })).toBe(16);
	});
	it("maps grays to the 256 grayscale ramp", () => {
		expect(rgbToAnsi256({ r: 128, g: 128, b: 128 })).toBeGreaterThanOrEqual(232);
	});
	it("maps to nearest basic-16", () => {
		expect(rgbToAnsi16({ r: 255, g: 0, b: 0 })).toBe(9); // bright red
		expect(rgbToAnsi16({ r: 0, g: 0, b: 0 })).toBe(0); // black
	});
});

describe("projectThemeToTui", () => {
	it("projects a color token to truecolor + 256 + 16", () => {
		const tui = projectThemeToTui(completeTheme({ primary: "#90b4e8" }));
		expect(tui.primary).toMatchObject({
			source: "#90b4e8",
			rgb: { r: 144, g: 180, b: 232 },
			hex: "#90b4e8",
		});
		expect(typeof tui.primary?.ansi256).toBe("number");
		expect(typeof tui.primary?.ansi16).toBe("number");
	});

	it("omits non-color tokens (radius/shadow/font)", () => {
		const tui = projectThemeToTui(completeTheme());
		const keys = Object.keys(tui);
		expect(keys).not.toContain("radius-sm");
		expect(keys).not.toContain("font-mono");
		expect(keys).not.toContain("shadow-lg");
		// Every color token is present.
		expect(keys.sort()).toEqual([...TUI_COLOR_TOKENS].sort());
	});

	it("skips a color token whose value it cannot parse", () => {
		const tui = projectThemeToTui(completeTheme({ primary: "hsl(210 40% 50%)" }));
		expect(tui.primary).toBeUndefined();
		// Other color tokens still project.
		expect(tui.background).toBeDefined();
	});

	it("is the terminal analogue of the web projection: same neutral theme in", () => {
		// The same DsTheme that feeds tokens.css (web) feeds this (TUI).
		const theme = completeTheme({ error: "#ff6b6b" });
		const tui = projectThemeToTui(theme);
		expect(tui.error?.rgb).toEqual({ r: 255, g: 107, b: 107 });
	});
});
