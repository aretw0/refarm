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

/** One theme to emit: an id and its base DTCG token file. (Mode overrides are added in a later slice.) */
export interface ThemeEmitEntry {
	id: string;
	base: DtcgTokenFile;
}

/**
 * Emit the scoped CSS for a base theme, byte-faithful to the hand-authored `themes/<id>.css`:
 * `@layer ds.theme { <dual-selector> { --token: value; … } }`, tabs, contract-token order, trailing
 * newline. The drift-guard test asserts this equals the committed file, so a change to the DTCG source
 * that is not regenerated (or a hand-edit of the generated CSS) is caught.
 */
export function emitThemeCss(entry: ThemeEmitEntry): string {
	const body = declarations(dtcgToDsTheme(entry.base));
	return `@layer ${LAYER} {\n\t${themeSelector(entry.id)} {\n${body}\n\t}\n}\n`;
}
