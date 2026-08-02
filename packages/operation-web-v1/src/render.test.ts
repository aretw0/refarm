import { describe, expect, it } from "vitest";
import { createOperationMessages } from "./messages.js";
import { renderOperationSurfaceHtml } from "./render.js";

describe("DS-backed operation projection", () => {
	it("uses canonical DS cards, buttons and feedback with escaped node data", () => {
		const html = renderOperationSurfaceHtml({
			messages: createOperationMessages(["pt-BR"]),
			operations: [{ id: "workspace:x:<bad>", command: "run <script>", why: "porque & como" }],
		});
		expect(html).toContain('class="ds-section"');
		expect(html).toContain('class="ds-card"');
		expect(html).toContain('class="ds-btn"');
		expect(html).toContain("Operações");
		expect(html).toContain("workspace:x:&lt;bad&gt;");
		expect(html).not.toContain("<script>");
	});

	it("renders the localized closed empty state", () => {
		const html = renderOperationSurfaceHtml({
			messages: createOperationMessages(["en"]),
			operations: [],
		});
		expect(html).toContain("no operation admitted");
		expect(html).toContain('role="status"');
	});

	it("does not leave the loading verdict behind after the catalog arrives", () => {
		const html = renderOperationSurfaceHtml({
			messages: createOperationMessages(["en"]),
			operations: [{ id: "delivery add", command: "refarm delivery add", why: "guided" }],
		});
		expect(html).not.toContain("Loading admitted operations");
	});
});
