import { toPendingPrompt } from "@refarm.dev/prompt-contract-v1";
import { describe, expect, it } from "vitest";

import { renderAttendPromptHtml } from "./render.js";
import { attendPromptView } from "./view.js";

describe("shared design-system projection", () => {
	it("renders a confirm as a DS card with bounded answer hooks", () => {
		const pending = toPendingPrompt({ type: "confirm", question: "Apply?" }, {
			id: "p-1",
			asker: { command: "refarm apply", host: "node" },
			askedAt: 1,
		});
		const html = renderAttendPromptHtml(attendPromptView(pending, 1));
		expect(html).toContain('class="ds-card"');
		expect(html).toContain('data-attend-prompt="p-1"');
		expect(html).toContain('class="ds-btn"');
		expect(html).toContain('data-attend-answer="true"');
		expect(html).toContain('role="group"');
		expect(html).not.toContain("<script");
	});

	it("escapes prompt and option content while preserving opaque values", () => {
		const pending = toPendingPrompt({
			type: "select",
			question: "<choose>",
			options: [{ value: 'a"b', label: "<A>" }],
		}, { id: "p-2", asker: { command: "ask" }, askedAt: 1 });
		const html = renderAttendPromptHtml(attendPromptView(pending, 1));
		expect(html).toContain("&lt;choose&gt;");
		expect(html).toContain("&lt;A&gt;");
		expect(html).toContain('value="a&quot;b"');
	});
});
