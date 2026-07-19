// Generate the shipped theme artifacts from the DTCG source. Run with `pnpm -C packages/ds run generate`
// (a `prebuild` hook, so `build` always regenerates). Reads tokens/themes.manifest.json + each DTCG token
// file and writes themes/<id>.css using the shared, pure emitter (tokens-emit.ts) — so the generated CSS
// can never drift from the source (the drift-guard test re-proves it in CI, where generate isn't run).
// The generated files are DERIVED: never hand-edit them; edit the DTCG source and regenerate.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { emitThemeCss } from "../src/tokens-emit.js";
import { resolveThemeEntry, type ThemesManifest } from "../src/tokens-manifest.js";
import type { DtcgTokenFile } from "../src/tokens-source.js";

const TOKENS_DIR = new URL("../src/tokens/", import.meta.url);
const THEMES_DIR = new URL("../src/themes/", import.meta.url);

const loadTokens = (fileName: string): DtcgTokenFile =>
	JSON.parse(readFileSync(fileURLToPath(new URL(fileName, TOKENS_DIR)), "utf8")) as DtcgTokenFile;

const manifest = JSON.parse(
	readFileSync(fileURLToPath(new URL("themes.manifest.json", TOKENS_DIR)), "utf8"),
) as ThemesManifest;

for (const theme of manifest.themes) {
	const css = emitThemeCss(resolveThemeEntry(theme, loadTokens));
	writeFileSync(fileURLToPath(new URL(`${theme.id}.css`, THEMES_DIR)), css);
	console.log(`generated themes/${theme.id}.css`);
}
