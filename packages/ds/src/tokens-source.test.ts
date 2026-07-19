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

/** Every theme's BASE DTCG file — each must be contract-complete (30 tokens). */
const COMPLETE_THEMES = ["tractor-green", "oceano", "terracota", "verde-jardim"] as const;

/** Assert a DTCG file's present contract tokens are real `{ $type, $value }` leaves a standard tool
 * (Style Dictionary / Tokens Studio / Figma) could parse — not a lookalike. */
function expectValidDtcg(file: DtcgTokenFile): void {
	for (const token of REQUIRED_TOKENS) {
		const entry = file[token];
		if (entry === undefined) continue; // a partial (override) file legitimately omits tokens
		expect(entry, `${token} is an object`).toBeTypeOf("object");
		const leaf = entry as DtcgToken;
		expect(typeof leaf.$value, `${token}.$value is a string`).toBe("string");
		expect(DTCG_TYPES.has(leaf.$type ?? ""), `${token}.$type "${leaf.$type}" is a DTCG type`).toBe(true);
	}
}

describe("DTCG token source → DsTheme", () => {
	it.each(COMPLETE_THEMES)("%s base flattens to a conformant DsTheme (all 30 contract tokens)", (id) => {
		const result = runDsThemeConformance(dtcgToDsTheme(loadTokens(`${id}.tokens.json`)));
		expect(result.pass).toBe(true);
		expect(result.missing).toEqual([]);
	});

	it.each(COMPLETE_THEMES)("%s base is valid DTCG (every token a standard { $type, $value } leaf)", (id) => {
		expectValidDtcg(loadTokens(`${id}.tokens.json`));
	});

	it("verde-jardim light override is a valid PARTIAL DTCG (redefines colors + shadows, omits radius/font)", () => {
		const light = loadTokens("verde-jardim.light.tokens.json");
		expectValidDtcg(light); // valid leaves…
		expect(light["primary"]).toBeTypeOf("object"); // …a color it overrides…
		expect(light["radius-md"]).toBeUndefined(); // …and intentionally NOT contract-complete.
		expect(light["font-sans"]).toBeUndefined();
	});
});
