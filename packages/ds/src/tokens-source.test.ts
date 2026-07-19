import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { REQUIRED_TOKENS } from "./contract.js";
import { runDsThemeConformance } from "./theme-conformance.js";
import { dtcgToDsTheme, type DtcgToken, type DtcgTokenFile } from "./tokens-source.js";

function loadTokens(name: string): DtcgTokenFile {
	return JSON.parse(
		readFileSync(fileURLToPath(new URL(`./tokens/${name}`, import.meta.url)), "utf8"),
	) as DtcgTokenFile;
}

/** The DTCG-defined `$type`s (Design Tokens Format Module). A source file that uses one of these is real
 * DTCG a standard tool (Style Dictionary, Tokens Studio, Figma) can parse — not a lookalike. */
const DTCG_TYPES = new Set([
	"color", "dimension", "fontFamily", "fontWeight", "duration", "cubicBezier", "number",
	"strokeStyle", "border", "transition", "shadow", "gradient", "typography",
]);

describe("DTCG token source → DsTheme", () => {
	it("tractor-green DTCG source flattens to a conformant DsTheme (all 30 contract tokens)", () => {
		const result = runDsThemeConformance(dtcgToDsTheme(loadTokens("tractor-green.tokens.json")));
		expect(result.pass).toBe(true);
		expect(result.missing).toEqual([]);
	});

	it("is valid DTCG: every contract token is a { $type, $value } leaf with a standard $type", () => {
		const file = loadTokens("tractor-green.tokens.json");
		for (const token of REQUIRED_TOKENS) {
			const entry = file[token];
			expect(entry, `${token} is present`).toBeTypeOf("object");
			const leaf = entry as DtcgToken;
			expect(typeof leaf.$value, `${token}.$value is a string`).toBe("string");
			expect(DTCG_TYPES.has(leaf.$type ?? ""), `${token}.$type "${leaf.$type}" is a DTCG type`).toBe(true);
		}
	});
});
