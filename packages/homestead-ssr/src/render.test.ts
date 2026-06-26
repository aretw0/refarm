import { describe, expect, it } from "vitest";
import {
	buttonHtml,
	cardHtml,
	escapeHtml,
	feedbackHtml,
	fieldHtml,
	footerHtml,
	gridHtml,
	sectionHtml,
	tableHtml,
} from "./render.js";

describe("homestead ssr render helpers", () => {
	it("escapes html-sensitive characters", () => {
		expect(escapeHtml(`<a href="x">&'`)).toBe(
			"&lt;a href=&quot;x&quot;&gt;&amp;&#x27;",
		);
		expect(escapeHtml(null)).toBe("");
	});

	it("cardHtml uses ds-card and escapes the title", () => {
		const html = cardHtml({
			title: "<b>Tel</b>",
			rows: ["<div>r</div>"],
			active: true,
		});
		expect(html).toContain('class="ds-card"');
		expect(html).toContain('data-active="1"');
		expect(html).toContain("&lt;b&gt;Tel&lt;/b&gt;");
		expect(html).toContain("<div>r</div>");
	});

	it("buttonHtml emits ds-btn + variant + escaped attrs", () => {
		const html = buttonHtml({
			label: "Save",
			variant: "danger",
			attrs: { "data-svc": 'a"b' },
		});
		expect(html).toContain('class="ds-btn"');
		expect(html).toContain('data-variant="danger"');
		expect(html).toContain('data-svc="a&quot;b"');
		expect(html).toContain(">Save<");
	});

	it("tableHtml renders headers and rows with escaping", () => {
		const html = tableHtml({ headers: ["A"], rows: [["<x>"]] });
		expect(html).toContain('class="ds-table"');
		expect(html).toContain("<th>A</th>");
		expect(html).toContain("<td>&lt;x&gt;</td>");
	});

	it("fieldHtml binds label to input id", () => {
		const html = fieldHtml({ label: "Token", name: "tok", value: "v" });
		expect(html).toContain('for="tok"');
		expect(html).toContain('id="tok"');
		expect(html).toContain('value="v"');
	});

	it("feedbackHtml sets data-kind and role", () => {
		expect(feedbackHtml({ kind: "error", message: "no" })).toContain(
			'data-kind="error"',
		);
		expect(feedbackHtml({ kind: "error", message: "no" })).toContain(
			'role="status"',
		);
	});

	it("section/grid/footer wrap with ds classes", () => {
		expect(sectionHtml("T", "<i>")).toContain('class="ds-section"');
		expect(gridHtml(["<a>", "<b>"])).toBe(
			'<div class="ds-grid"><a><b></div>',
		);
		expect(footerHtml("f")).toContain('class="ds-footer"');
	});
});
