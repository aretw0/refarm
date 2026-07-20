/**
 * Resolve the bench's TUI theme — a projected DS token theme applied to the `dashboard` + `status-panel`
 * faces. `DGK_TUI_THEME` names a built-in DS theme (BUILTIN_THEMES from @refarm.dev/ds); default
 * "tractor-green". `projectThemeToTui` flattens the DTCG tokens to terminal colors (ansi256), so declaring
 * the theme ONCE colors every TUI face (the color half of the DS→TUI convergence). Pure — env injected.
 */
import { BUILTIN_THEMES, projectThemeToTui } from "@refarm.dev/ds";
import type { TuiThemeLike } from "@refarm.dev/surface-terminal";

export const DEVBENCH_DEFAULT_TUI_THEME = "tractor-green";

/** The builtin DS theme names available to `DGK_TUI_THEME`. */
export const DEVBENCH_TUI_THEMES = Object.keys(BUILTIN_THEMES);

/** Project the selected builtin DS theme to terminal colors. An unknown name falls back to the default;
 * an unknown default (shouldn't happen) falls back to an empty theme → the neutral face colorizers. */
export function resolveDevbenchTuiTheme(env: NodeJS.ProcessEnv = process.env): TuiThemeLike {
	const name = env.DGK_TUI_THEME ?? DEVBENCH_DEFAULT_TUI_THEME;
	const theme = BUILTIN_THEMES[name] ?? BUILTIN_THEMES[DEVBENCH_DEFAULT_TUI_THEME] ?? {};
	return projectThemeToTui(theme);
}
