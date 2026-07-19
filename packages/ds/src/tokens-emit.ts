// Deterministic emit from the DTCG source to the CSS the web ships. PURE (DTCG file → CSS string), so the
// generate script and the drift-guard test share one emitter and the output is reproducible byte-for-byte.
// The emitter — not Style Dictionary — owns refarm's bespoke CSS conventions: the `@layer ds.theme` cascade
// layer and the white-label dual selector `:where([data-ds-theme="X"], [data-refarm-theme="X"])`. (Style
// Dictionary is deferred to the first native-platform target, where its format library pays; the DTCG
// source is exactly what lets it drop in then without re-authoring tokens.)

import { REQUIRED_TOKENS } from "./contract.js";
import { dtcgToDsTheme, type DtcgTokenFile } from "./tokens-source.js";

/** The cascade layer every theme's declarations live under. */
const LAYER = "ds.theme";

/** The white-label dual selector for a theme id — both the `ds` and `refarm` data-attributes resolve it,
 * wrapped in `:where(...)` so the theme adds no specificity a host would have to fight. */
export function themeSelector(id: string): string {
	return `:where([data-ds-theme="${id}"], [data-refarm-theme="${id}"])`;
}

/** The token declaration lines (two-tab indented, contract order) for a theme's value map. Only tokens
 * the map defines are emitted, in `REQUIRED_TOKENS` order so the output is stable and diff-friendly. */
function declarations(values: Partial<Record<string, string>>): string {
	return REQUIRED_TOKENS.filter((token) => typeof values[token] === "string")
		.map((token) => `\t\t--${token}: ${values[token]};`)
		.join("\n");
}

/** One mode of a theme (e.g. light / dark): the `data-mode` value it matches, the `color-scheme` it
 * declares, and its token OVERRIDES (a partial DTCG file) — or none, for a marker-only mode. */
export interface ThemeModeEmit {
	name: string;
	colorScheme: string;
	override?: DtcgTokenFile;
}

/** One theme to emit: an id, its complete base DTCG file, and any mode overrides (light/dark). */
export interface ThemeEmitEntry {
	id: string;
	base: DtcgTokenFile;
	modes?: readonly ThemeModeEmit[];
}

/** The base declarations block for a theme: `\t<selector> {\n<body>\n\t}`. */
function baseBlock(id: string, base: DtcgTokenFile): string {
	return `\t${themeSelector(id)} {\n${declarations(dtcgToDsTheme(base))}\n\t}`;
}

/** A mode block: the dual `[data-mode="X"]` selector (both `selector[data-mode]` and
 * `[data-mode] selector`), a `color-scheme`, then this mode's token overrides in contract order. */
function modeBlock(id: string, mode: ThemeModeEmit): string {
	const selector = themeSelector(id);
	const head = `\t${selector}[data-mode="${mode.name}"],\n\t[data-mode="${mode.name}"] ${selector} {`;
	const lines = [`\t\tcolor-scheme: ${mode.colorScheme};`];
	const overrides = mode.override ? declarations(dtcgToDsTheme(mode.override)) : "";
	if (overrides) lines.push(overrides);
	return `${head}\n${lines.join("\n")}\n\t}`;
}

/**
 * Emit the scoped CSS for a theme, byte-faithful to the hand-authored `themes/<id>.css`:
 * `@layer ds.theme { <base block> [\n\n<mode block>…] }`, tabs, contract-token order, blocks separated by
 * a blank line, trailing newline. A base-only theme emits just the base block (identical to before modes).
 * The drift-guard test asserts this equals the committed file, so a DTCG-source change that is not
 * regenerated (or a hand-edit of the generated CSS) is caught.
 */
export function emitThemeCss(entry: ThemeEmitEntry): string {
	const blocks = [
		baseBlock(entry.id, entry.base),
		...(entry.modes ?? []).map((mode) => modeBlock(entry.id, mode)),
	];
	return `@layer ${LAYER} {\n${blocks.join("\n\n")}\n}\n`;
}
