/**
 * Resolve the bench's TUI theme — a projected DS token theme applied to the `dashboard` + `status-panel`
 * faces. `DGK_TUI_THEME` names a built-in DS theme (BUILTIN_THEMES from @refarm.dev/ds); default
 * "tractor-green". `projectThemeToTui` flattens the DTCG tokens to terminal colors (ansi256), so declaring
 * the theme ONCE colors every TUI face (the color half of the DS→TUI convergence). Pure — env injected.
 */
import { BUILTIN_THEMES, resolveBuiltinTuiTheme } from "@refarm.dev/ds";
import type { TuiThemeLike } from "@refarm.dev/surface-terminal";

export const DEVBENCH_DEFAULT_TUI_THEME = "tractor-green";

/** The builtin DS theme names available to `DGK_TUI_THEME`. */
export const DEVBENCH_TUI_THEMES = Object.keys(BUILTIN_THEMES);

/** Project the `DGK_TUI_THEME` builtin DS theme to terminal colors (the shared ds resolver; unknown name →
 * the default → an empty theme = neutral face colorizers). */
export function resolveDevbenchTuiTheme(env: NodeJS.ProcessEnv = process.env): TuiThemeLike {
	return resolveBuiltinTuiTheme(env.DGK_TUI_THEME, DEVBENCH_DEFAULT_TUI_THEME);
}
