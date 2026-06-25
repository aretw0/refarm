import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { REQUIRED_TOKENS, type DsTheme } from "./contract.js";
import { runDsThemeConformance } from "./theme-conformance.js";

function tokensInThemeCss(relPath: string): Partial<DsTheme> {
	const css = readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
	const out: Record<string, string> = {};
	for (const token of REQUIRED_TOKENS) {
		const match = new RegExp(`--${token}\\s*:\\s*([^;]+);`).exec(css);
		if (match) out[token] = match[1]!.trim();
	}
	return out as Partial<DsTheme>;
}

function tokensInCssBlock(css: string, selector: string): Partial<DsTheme> {
	const start = css.indexOf(selector);
	if (start === -1) return {};
	const open = css.indexOf("{", start);
	const close = css.indexOf("}", open);
	const block = css.slice(open + 1, close);
	const out: Record<string, string> = {};
	for (const token of REQUIRED_TOKENS) {
		const match = new RegExp(`--${token}\\s*:\\s*([^;]+);`).exec(block);
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

	it("verde-jardim ships the Lab-proven light mode values", () => {
		const css = readFileSync(
			fileURLToPath(new URL("./themes/verde-jardim.css", import.meta.url)),
			"utf8",
		);
		const light = tokensInCssBlock(
			css,
			'[data-refarm-theme="verde-jardim"][data-mode="light"]',
		);
		expect(light).toMatchObject({
			background: "#f7f5f0",
			foreground: "#12100e",
			primary: "#1b5e3b",
			"primary-foreground": "#f7f5f0",
			accent: "#d4ede0",
			"accent-foreground": "#0f3d26",
		});
		expect(light["shadow-md"]).toBeDefined();
		expect(css).toContain('[data-mode="light"] [data-refarm-theme="verde-jardim"]');
		expect(css).toContain('[data-refarm-theme="verde-jardim"][data-mode="dark"]');
	});
});
