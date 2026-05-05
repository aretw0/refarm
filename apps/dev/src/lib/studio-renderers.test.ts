import { describe, expect, it } from "vitest";
import {
	findStudioRenderer,
	resolveStudioRenderer,
	STUDIO_HEADLESS_RENDERER,
	STUDIO_RENDERERS,
	STUDIO_WEB_RENDERER,
} from "./studio-renderers";

describe("studio renderer catalog", () => {
	it("collects product-owned renderer descriptors", () => {
		expect(STUDIO_RENDERERS).toEqual([
			STUDIO_WEB_RENDERER,
			STUDIO_HEADLESS_RENDERER,
		]);
		expect(STUDIO_WEB_RENDERER).toEqual(
			expect.objectContaining({
				id: "refarm-dev-web",
				kind: "web",
				metadata: { app: "apps/dev" },
			}),
		);
		expect(STUDIO_HEADLESS_RENDERER).toEqual(
			expect.objectContaining({
				id: "refarm-dev-headless",
				kind: "headless",
				metadata: { app: "apps/dev" },
			}),
		);
	});

	it("finds renderers by supported kind", () => {
		expect(findStudioRenderer("web")).toBe(STUDIO_WEB_RENDERER);
		expect(findStudioRenderer("headless")).toBe(STUDIO_HEADLESS_RENDERER);
		expect(findStudioRenderer("tui")).toBeUndefined();
		expect(findStudioRenderer("mobile")).toBeUndefined();
		expect(findStudioRenderer(undefined)).toBeUndefined();
	});

	it("resolves unsupported kinds to the web renderer by default", () => {
		expect(resolveStudioRenderer("headless")).toBe(STUDIO_HEADLESS_RENDERER);
		expect(resolveStudioRenderer("tui")).toBe(STUDIO_WEB_RENDERER);
		expect(resolveStudioRenderer("mobile")).toBe(STUDIO_WEB_RENDERER);
	});
});
