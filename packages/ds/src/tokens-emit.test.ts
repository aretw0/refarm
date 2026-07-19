import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { emitThemeCss, themeSelector } from "./tokens-emit.js";
import { resolveThemeEntry, type ThemesManifest } from "./tokens-manifest.js";
import type { DtcgTokenFile } from "./tokens-source.js";

function loadTokens(fileName: string): DtcgTokenFile {
	return JSON.parse(
		readFileSync(fileURLToPath(new URL(`./tokens/${fileName}`, import.meta.url)), "utf8"),
	) as DtcgTokenFile;
}
function committedCss(name: string): string {
	return readFileSync(fileURLToPath(new URL(`./themes/${name}`, import.meta.url)), "utf8");
}

const manifest = JSON.parse(
	readFileSync(fileURLToPath(new URL("./tokens/themes.manifest.json", import.meta.url)), "utf8"),
) as ThemesManifest;

describe("token emit is byte-faithful to the shipped CSS (drift guard)", () => {
	// The exact inverse of scripts/generate-tokens.ts: resolve every manifest theme and assert its emit
	// equals the committed CSS, byte for byte. If this fails, the DTCG source and the generated CSS
	// diverged — run `pnpm -C packages/ds run generate` (or a generated CSS was hand-edited). This
	// re-proves fidelity in CI, where generate does not run.
	it.each(manifest.themes.map((theme) => theme.id))(
		"%s: emit(DTCG source, via manifest) === committed themes/%s.css",
		(id) => {
			const theme = manifest.themes.find((entry) => entry.id === id)!;
			expect(emitThemeCss(resolveThemeEntry(theme, loadTokens))).toBe(committedCss(`${id}.css`));
		},
	);
});

describe("themeSelector — white-label dual selector", () => {
	it("resolves both the ds and refarm data-attributes, at zero specificity", () => {
		expect(themeSelector("tractor-green")).toBe(
			':where([data-ds-theme="tractor-green"], [data-refarm-theme="tractor-green"])',
		);
	});
});
