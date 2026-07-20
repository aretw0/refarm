import { BUILTIN_THEMES, projectThemeToTui } from "@refarm.dev/ds";
import { defaultStatusColors, renderStatusPanel, statusColorsFromTuiTheme } from "@refarm.dev/surface-terminal";
import { describe, expect, it } from "vitest";

import { DEVBENCH_DEFAULT_TUI_THEME, resolveDevbenchTuiTheme } from "./tui-theme.js";

describe("resolveDevbenchTuiTheme (DS token theme → TUI colors)", () => {
	it("projects the default builtin theme's tokens to ansi256", () => {
		const theme = resolveDevbenchTuiTheme({});
		const expected = projectThemeToTui(BUILTIN_THEMES[DEVBENCH_DEFAULT_TUI_THEME]!);
		expect(theme.primary?.ansi256).toBe(expected.primary?.ansi256);
		expect(theme.foreground?.ansi256).toBe(expected.foreground?.ansi256);
		expect(typeof theme.primary?.ansi256).toBe("number");
	});

	it("DGK_TUI_THEME selects a builtin; an unknown name falls back to the default", () => {
		const other = Object.keys(BUILTIN_THEMES).find((name) => name !== DEVBENCH_DEFAULT_TUI_THEME);
		if (other) {
			expect(resolveDevbenchTuiTheme({ DGK_TUI_THEME: other })).toEqual(projectThemeToTui(BUILTIN_THEMES[other]!));
		}
		expect(resolveDevbenchTuiTheme({ DGK_TUI_THEME: "no-such-theme" })).toEqual(resolveDevbenchTuiTheme({}));
	});
});

describe("theme e2e: a declared DS theme reaches the TUI face", () => {
	it("feeds the status-panel colorizers — themed from the tokens, not the chalk defaults", () => {
		const colors = statusColorsFromTuiTheme(resolveDevbenchTuiTheme({}));
		expect(colors.label).not.toBe(defaultStatusColors.label);
		expect(colors.next).not.toBe(defaultStatusColors.next);
		expect(colors.summary).not.toBe(defaultStatusColors.summary);
	});

	it("renders a status panel with the themed colors (token → laid-out face, no throw)", async () => {
		const panel = await renderStatusPanel(
			{ units: [{ label: "Runtime", summary: "ready", severity: "ok" }], nextCommands: ["dgk check"] },
			{ width: 60, colors: statusColorsFromTuiTheme(resolveDevbenchTuiTheme({})) },
		);
		expect(panel).toContain("Runtime");
		expect(panel).toContain("dgk check");
	});
});
