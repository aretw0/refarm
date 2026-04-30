import { describe, expect, it } from "vitest";
import {
	renderStreamPanelHtml,
	renderStreamStatusbarHtml,
	sortedStreamObservationViews,
} from "../src/sdk/stream-observer";

describe("Homestead stream observer rendering", () => {
	it("sorts stream views deterministically", () => {
		const views = sortedStreamObservationViews(
			{
				"stream-b": {
					"@type": "StreamSession",
					"@id": "session-b",
					stream_ref: "stream-b",
					stream_kind: "agent-response",
					status: "active",
				},
				"stream-a": {
					"@type": "StreamSession",
					"@id": "session-a",
					stream_ref: "stream-a",
					stream_kind: "agent-response",
					status: "active",
				},
			},
			{},
		);

		expect(views.map((view) => view.streamRef)).toEqual([
			"stream-a",
			"stream-b",
		]);
	});

	it("escapes stream content before rendering statusbar HTML", () => {
		const html = renderStreamStatusbarHtml([
			{
				streamRef: "stream-<unsafe>",
				promptRef: "prompt&1",
				status: "active",
				content: "<script>alert('x')</script>",
				isActive: true,
				isTerminal: false,
			},
		]);

		expect(html).toContain("stream-&lt;unsafe&gt;");
		expect(html).toContain("prompt&amp;1");
		expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
		expect(html).not.toContain("<script>");
	});

	it("renders a richer stream panel for Homestead surfaces", () => {
		const html = renderStreamPanelHtml([
			{
				streamRef: "stream-a",
				promptRef: "prompt-a",
				status: "active",
				content: "first line\nsecond line",
				isActive: true,
				isTerminal: false,
			},
		]);

		expect(html).toContain("Live soil telemetry");
		expect(html).toContain("Agent streams");
		expect(html).toContain("prompt-a");
		expect(html).toContain("first line");
	});
});
