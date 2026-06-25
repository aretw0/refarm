import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { runDsThemeConformance } from "./conformance.js";
import { REQUIRED_TOKENS, type DsTheme } from "./contract.js";

function tokensInThemeCss(relPath: string): Partial<DsTheme> {
	const css = readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
	const out: Record<string, string> = {};
	for (const token of REQUIRED_TOKENS) {
		const match = new RegExp(`--${token}\\s*:\\s*([^;]+);`).exec(css);
		if (match) out[token] = match[1]!.trim();
	}
	return out as Partial<DsTheme>;
}

describe("shipped theme CSS conformance", () => {
	it("tractor-green defines every required token", () => {
		const result = runDsThemeConformance(tokensInThemeCss("./themes/tractor-green.css"));
		expect(result.missing).toEqual([]);
		expect(result.pass).toBe(true);
	});

	it.each(["oceano", "terracota", "verde-jardim"])(
		"%s defines every required token",
		(name) => {
			const result = runDsThemeConformance(tokensInThemeCss(`./themes/${name}.css`));
			expect(result.missing).toEqual([]);
			expect(result.pass).toBe(true);
		},
	);
});
