import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { emitThemeCss, themeSelector } from "./tokens-emit.js";
import type { DtcgTokenFile } from "./tokens-source.js";

function loadTokens(name: string): DtcgTokenFile {
	return JSON.parse(
		readFileSync(fileURLToPath(new URL(`./tokens/${name}`, import.meta.url)), "utf8"),
	) as DtcgTokenFile;
}
function committedCss(name: string): string {
	return readFileSync(fileURLToPath(new URL(`./themes/${name}`, import.meta.url)), "utf8");
}

describe("token emit is byte-faithful to the shipped CSS (drift guard)", () => {
	// If this fails, the DTCG source and the generated CSS diverged: run `pnpm -C packages/ds run generate`
	// (or someone hand-edited the generated CSS). This re-proves fidelity in CI, where generate isn't run.
	it("tractor-green: emit(DTCG source) === committed themes/tractor-green.css, byte for byte", () => {
		const css = emitThemeCss({ id: "tractor-green", base: loadTokens("tractor-green.tokens.json") });
		expect(css).toBe(committedCss("tractor-green.css"));
	});
});

describe("themeSelector — white-label dual selector", () => {
	it("resolves both the ds and refarm data-attributes, at zero specificity", () => {
		expect(themeSelector("tractor-green")).toBe(
			':where([data-ds-theme="tractor-green"], [data-refarm-theme="tractor-green"])',
		);
	});
});
