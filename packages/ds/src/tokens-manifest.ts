// The theme manifest reader: turns a themes.manifest.json entry into a ThemeEmitEntry, loading the DTCG
// files through an INJECTED loader so this stays pure + testable and both the generator (scripts/
// generate-tokens.ts) and the drift-guard test share one resolution path — the test is then the exact
// inverse of generation.

import type { ThemeEmitEntry, ThemeModeEmit } from "./tokens-emit.js";
import type { DtcgTokenFile } from "./tokens-source.js";

/** A mode entry in the manifest: the `data-mode` value, its `color-scheme`, and an optional override file
 * (absent → a marker-only mode, e.g. dark). */
export interface ManifestMode {
	name: string;
	colorScheme: string;
	override?: string;
}

/** A theme entry in the manifest: the emitted id, its base DTCG file, and any modes. */
export interface ManifestTheme {
	id: string;
	base: string;
	modes?: ManifestMode[];
}

/** The manifest shape (`tokens/themes.manifest.json`). `$description` is documentation only. */
export interface ThemesManifest {
	$description?: string;
	themes: ManifestTheme[];
}

/** Resolve a manifest theme to a ThemeEmitEntry, loading each referenced DTCG file via `load` (injected,
 * so callers own the I/O and this is pure). Marker-only modes (no `override`) resolve without a file. */
export function resolveThemeEntry(
	theme: ManifestTheme,
	load: (fileName: string) => DtcgTokenFile,
): ThemeEmitEntry {
	const modes: ThemeModeEmit[] | undefined = theme.modes?.map((mode) => ({
		name: mode.name,
		colorScheme: mode.colorScheme,
		...(mode.override ? { override: load(mode.override) } : {}),
	}));
	return { id: theme.id, base: load(theme.base), ...(modes ? { modes } : {}) };
}
