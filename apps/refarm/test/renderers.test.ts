import { describe, expect, it } from "vitest";
import {
	REFARM_HEADLESS_RENDERER,
	REFARM_TUI_RENDERER,
	REFARM_WEB_RENDERER,
	resolveRefarmRenderer,
} from "../src/renderers.js";

describe("refarm renderers", () => {
	it("exposes canonical descriptors for web, tui and headless", () => {
		expect(REFARM_WEB_RENDERER.kind).toBe("web");
		expect(REFARM_TUI_RENDERER.kind).toBe("tui");
		expect(REFARM_HEADLESS_RENDERER.kind).toBe("headless");
	});

	it("resolves renderer descriptors by kind", () => {
		expect(resolveRefarmRenderer("web")).toEqual(REFARM_WEB_RENDERER);
		expect(resolveRefarmRenderer("tui")).toEqual(REFARM_TUI_RENDERER);
		expect(resolveRefarmRenderer("headless")).toEqual(REFARM_HEADLESS_RENDERER);
	});
});
