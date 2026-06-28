import { describe, expect, it } from "vitest";
import { shellHtml } from "./index.js";

describe("homestead ssr shellHtml", () => {
	it("emits a scoped document linking ds css under assetBase", () => {
		const html = shellHtml({
			title: "dgk admin",
			theme: "verde-jardim",
			assetBase: "/_ds",
			bodyHtml: "<main>x</main>",
		});

		expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
		expect(html).toContain('<body data-ds-theme="verde-jardim">');
		expect(html).toContain('href="/_ds/tokens.css"');
		expect(html).toContain('href="/_ds/themes/verde-jardim.css"');
		expect(html).toContain('href="/_ds/components.css"');
		expect(html).toContain("<title>dgk admin</title>");
		expect(html).toContain("<main>x</main>");
	});

	it("defaults lang=en, theme=tractor-green, assetBase=/_ds", () => {
		const html = shellHtml({ title: "t", bodyHtml: "" });

		expect(html).toContain('lang="en"');
		expect(html).toContain('data-ds-theme="tractor-green"');
		expect(html).toContain('href="/_ds/themes/tractor-green.css"');
	});
});
