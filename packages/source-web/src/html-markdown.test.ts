import { describe, expect, it } from "vitest";

import {
	decodeHtmlEntities,
	htmlToMarkdown,
	minimalHtmlToMarkdown,
	stripNonContentHtml,
} from "./html-markdown.js";

describe("stripNonContentHtml", () => {
	it("removes scripts, styles, and comments with their content", () => {
		const html = `<p>keep</p><script>evil()</script><style>.x{}</style><!-- note -->`;
		expect(stripNonContentHtml(html)).toBe("<p>keep</p>");
	});
});

describe("decodeHtmlEntities", () => {
	it("decodes named, numeric, and hex entities", () => {
		expect(decodeHtmlEntities("a &amp; b &lt; c &#39;d&#39; &#x2764;")).toBe("a & b < c 'd' ❤");
	});
});

describe("minimalHtmlToMarkdown", () => {
	it("renders headings and paragraphs", () => {
		const md = minimalHtmlToMarkdown("<h2>Título</h2><p>corpo do <strong>texto</strong>.</p>");
		expect(md).toBe("## Título\n\ncorpo do **texto**.");
	});

	it("renders links inline", () => {
		const md = minimalHtmlToMarkdown(`<p>ver <a href="/req/42">REQ-42</a> agora</p>`);
		expect(md).toBe("ver [REQ-42](/req/42) agora");
	});

	it("renders a list, preserving each item", () => {
		const md = minimalHtmlToMarkdown("<ul><li>um</li><li>dois</li></ul>");
		expect(md).toBe("- um\n- dois");
	});

	it("renders a table as GFM — the shape a tag-strip destroys", () => {
		const html = `<table>
			<tr><th>Critério</th><th>Estado</th></tr>
			<tr><td>Login</td><td>OK</td></tr>
		</table>`;
		const md = minimalHtmlToMarkdown(html);
		expect(md).toBe("| Critério | Estado |\n| --- | --- |\n| Login | OK |");
	});

	it("renders block code without inline-processing its content", () => {
		const md = minimalHtmlToMarkdown("<pre>const x = a &amp;&amp; b;</pre>");
		expect(md).toBe("```\nconst x = a && b;\n```");
	});

	it("pads ragged table rows to the widest", () => {
		const md = minimalHtmlToMarkdown("<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>");
		expect(md).toBe("| a | b |\n| --- | --- |\n| c | |");
	});

	it("escapes pipes inside table cells", () => {
		const md = minimalHtmlToMarkdown("<table><tr><td>a|b</td></tr></table>");
		expect(md).toContain("a\\|b");
	});
});

describe("htmlToMarkdown", () => {
	it("strips chrome and converts in one call", () => {
		const md = htmlToMarkdown(`<script>x</script><h1>H</h1><p>body</p>`);
		expect(md).toBe("# H\n\nbody");
	});

	it("narrows to a main region when markers are given", () => {
		const html = `<nav>MENU</nav><article><p>real content</p></article><footer>foot</footer>`;
		const md = htmlToMarkdown(html, { mainRegion: ["<article", "</article>"] });
		expect(md).toBe("real content");
	});

	it("uses the whole body when the main markers are absent", () => {
		const md = htmlToMarkdown(`<p>only this</p>`, { mainRegion: ["<article", "</article>"] });
		expect(md).toBe("only this");
	});

	it("accepts an injected converter (e.g. a Turndown adapter)", () => {
		const md = htmlToMarkdown("<p>ignored</p>", { converter: () => "FROM INJECTED" });
		expect(md).toBe("FROM INJECTED");
	});
});
