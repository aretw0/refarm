import { describe, expect, it } from "vitest";
import { homesteadSurfaceRenderContent } from "../src/sdk/surface-renderer";

describe("homesteadSurfaceRenderContent", () => {
	it("normalizes explicit HTML render results", () => {
		expect(
			homesteadSurfaceRenderContent({
				html: '<section data-refarm-example="stream">Ready</section>',
			}),
		).toEqual({
			kind: "html",
			value: '<section data-refarm-example="stream">Ready</section>',
		});
	});

	it("treats plain strings as text render results", () => {
		expect(homesteadSurfaceRenderContent("Ready")).toEqual({
			kind: "text",
			value: "Ready",
		});
	});

	it("ignores empty or unsupported render results", () => {
		expect(homesteadSurfaceRenderContent(null)).toBeUndefined();
		expect(homesteadSurfaceRenderContent({})).toBeUndefined();
	});
});
