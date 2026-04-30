import { describe, expect, it } from "vitest";
import {
	createScopedHomesteadSurfaceActionHandler,
	createScopedHomesteadSurfaceContextProvider,
	homesteadSurfaceRenderActionById,
	homesteadSurfaceRenderContent,
	homesteadSurfaceRenderContextMatches,
} from "../src/sdk/surface-renderer";

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

	it("finds host-declared actions by stable id", () => {
		expect(
			homesteadSurfaceRenderActionById(
				{
					hostId: "apps/dev",
					actions: [
						{ id: "open-streams", label: "Open streams" },
						{ id: "retry-stream", label: "Retry stream" },
					],
				},
				"retry-stream",
			),
		).toEqual({ id: "retry-stream", label: "Retry stream" });
		expect(
			homesteadSurfaceRenderActionById(undefined, "missing"),
		).toBeUndefined();
		expect(
			homesteadSurfaceRenderActionById({ actions: [] }, null),
		).toBeUndefined();
	});
});

describe("Homestead surface render context helpers", () => {
	const request = {
		pluginId: "studio-stream-surface-demo",
		slotId: "streams",
		mountSource: "extension-surface" as const,
		surface: {
			layer: "homestead" as const,
			kind: "panel",
			id: "studio-stream-panel",
			slot: "streams",
		},
		locale: "en",
	};

	it("matches scoped host context requests", () => {
		expect(
			homesteadSurfaceRenderContextMatches(request, {
				pluginId: "studio-stream-surface-demo",
				slotId: "streams",
				surfaceId: "studio-stream-panel",
				surfaceKind: "panel",
			}),
		).toBe(true);
		expect(
			homesteadSurfaceRenderContextMatches(request, {
				pluginId: "other-plugin",
			}),
		).toBe(false);
	});

	it("creates reusable scoped host action handlers", async () => {
		const handled: string[] = [];
		const handler = createScopedHomesteadSurfaceActionHandler(
			{
				pluginId: "studio-stream-surface-demo",
				surfaceId: "studio-stream-panel",
			},
			({ action }) => {
				handled.push(action.id);
			},
		);

		await handler({
			...request,
			action: { id: "open-streams", label: "Open streams" },
		});
		await handler({
			...request,
			pluginId: "other-plugin",
			action: { id: "ignored", label: "Ignored" },
		});

		expect(handled).toEqual(["open-streams"]);
	});

	it("creates reusable scoped host context providers", async () => {
		const provider = createScopedHomesteadSurfaceContextProvider(
			{
				pluginId: "studio-stream-surface-demo",
				surfaceId: "studio-stream-panel",
			},
			() => ({
				hostId: "apps/dev",
				data: { streamCount: 1 },
			}),
		);

		expect(await provider(request)).toEqual({
			hostId: "apps/dev",
			data: { streamCount: 1 },
		});
		expect(
			provider({
				...request,
				pluginId: "other-plugin",
			}),
		).toBeUndefined();
	});
});
