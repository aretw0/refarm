// Generate the shipped theme artifacts from the DTCG source. Run with `pnpm -C packages/ds run generate`
// (a `prebuild` hook, so `build` always regenerates). Reads tokens/themes.manifest.json + each DTCG token
// file and writes themes/<id>.css using the shared, pure emitter (tokens-emit.ts) — so the generated CSS
// can never drift from the source (the drift-guard test re-proves it in CI, where generate isn't run).
// The generated files are DERIVED: never hand-edit them; edit the DTCG source and regenerate.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { emitThemeCss } from "../src/tokens-emit.js";
import type { DtcgTokenFile } from "../src/tokens-source.js";

const TOKENS_DIR = new URL("../src/tokens/", import.meta.url);
const THEMES_DIR = new URL("../src/themes/", import.meta.url);

interface ManifestTheme {
	id: string;
	base: string;
	modes?: Record<string, string | null>;
}
interface Manifest {
	themes: ManifestTheme[];
}

function readJson<T>(url: URL): T {
	return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as T;
}

const manifest = readJson<Manifest>(new URL("themes.manifest.json", TOKENS_DIR));

for (const theme of manifest.themes) {
	const base = readJson<DtcgTokenFile>(new URL(theme.base, TOKENS_DIR));
	const css = emitThemeCss({ id: theme.id, base });
	writeFileSync(fileURLToPath(new URL(`${theme.id}.css`, THEMES_DIR)), css);
	console.log(`generated themes/${theme.id}.css`);
}
