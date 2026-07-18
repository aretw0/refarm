import { describe, expect, it } from "vitest";

import {
	conversationTranscriptStyles,
	renderConversationTranscript,
	type ConversationMessage,
} from "./conversation-transcript.js";

function at(year: number, month1: number, day: number, hour = 12, min = 0): number {
	return new Date(year, month1 - 1, day, hour, min).getTime();
}
const NOW = at(2026, 7, 18, 15, 0);

const me = { id: "me", name: "Arthur", kind: "operator" as const };
const agent = { id: "agent", name: "Agente", kind: "agent" as const };

describe("renderConversationTranscript", () => {
	it("returns an empty string for no messages", () => {
		expect(renderConversationTranscript([], { now: NOW })).toBe("");
	});

	it("groups by day, attributes others by name, aligns self, and shows compact times", () => {
		const messages: ConversationMessage[] = [
			{ sender: agent, at: at(2026, 7, 17, 9, 0), text: "olá de ontem" }, // Ontem
			{ sender: me, at: at(2026, 7, 18, 10, 0), text: "bom dia" }, // Hoje
			{ sender: agent, at: at(2026, 7, 18, 10, 1), text: "no que ajudo?" }, // Hoje
		];
		const html = renderConversationTranscript(messages, { now: NOW, selfId: "me" });

		// One day separator per day, in order.
		expect(html.indexOf("Ontem")).toBeGreaterThanOrEqual(0);
		expect(html.indexOf("Hoje")).toBeGreaterThan(html.indexOf("Ontem"));
		// Others carry a sender name; self does not, and self is marked for right-alignment.
		expect(html).toContain('<span class="refarm-convo-sender">Agente</span>');
		expect(html).not.toContain('<span class="refarm-convo-sender">Arthur</span>');
		expect(html).toContain("data-self");
		expect(html).toContain('data-kind="agent"');
		// A per-message time is rendered.
		expect(html).toContain("refarm-convo-time");
	});

	it("renders a system message as a centered notice, not a bubble", () => {
		const html = renderConversationTranscript(
			[{ sender: { id: "sys", name: "system", kind: "system" }, at: NOW, text: "turno cancelado" }],
			{ now: NOW },
		);
		expect(html).toContain('class="refarm-convo-system"');
		expect(html).toContain("turno cancelado");
		expect(html).not.toContain("refarm-convo-bubble");
	});

	it("renders a rich (html) message body verbatim as a block, marked data-rich (the inline-form seam)", () => {
		const html = renderConversationTranscript(
			[
				{
					sender: agent,
					at: NOW,
					text: "form fallback",
					html: '<form data-refarm-verb="search"><input data-refarm-arg="query" /></form>',
				},
			],
			{ now: NOW },
		);
		expect(html).toContain("data-rich");
		expect(html).toContain('<form data-refarm-verb="search">'); // verbatim, NOT escaped
		expect(html).toContain('<input data-refarm-arg="query" />');
		expect(html).not.toContain("form fallback"); // the html replaces the text body
	});

	it("escapes message text and sender names (no HTML injection)", () => {
		const html = renderConversationTranscript(
			[{ sender: { id: "x", name: "<b>x</b>", kind: "person" }, at: NOW, text: "<script>alert(1)</script>" }],
			{ now: NOW },
		);
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
		expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
	});
});

describe("conversationTranscriptStyles", () => {
	it("inherits DS tokens and avoids AI-slop tells (no gradient/glassmorphism)", () => {
		const css = conversationTranscriptStyles();
		expect(css).toContain("var(--refarm-");
		expect(css.toLowerCase()).not.toContain("gradient");
		expect(css.toLowerCase()).not.toContain("backdrop-filter");
		expect(css.toLowerCase()).not.toContain("blur(");
	});
});
