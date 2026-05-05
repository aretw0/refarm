import { describe, expect, it } from "vitest";
import {
	composeHomesteadSurfaceActionHandlers,
	composeHomesteadSurfaceContextProviders,
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

		await expect(
			handler({
				...request,
				action: { id: "open-streams", label: "Open streams" },
			}),
		).resolves.toBe(true);
		await expect(
			handler({
				...request,
				pluginId: "other-plugin",
				action: { id: "ignored", label: "Ignored" },
			}),
		).resolves.toBe(false);

		expect(handled).toEqual(["open-streams"]);
	});

	it("composes host action handlers until one handles the request", async () => {
		const handled: string[] = [];
		const first = createScopedHomesteadSurfaceActionHandler(
			{ pluginId: "other-plugin" },
			({ action }) => {
				handled.push(`first:${action.id}`);
			},
		);
		const second = createScopedHomesteadSurfaceActionHandler(
			{ pluginId: "studio-stream-surface-demo" },
			({ action }) => {
				handled.push(`second:${action.id}`);
			},
		);
		const composed = composeHomesteadSurfaceActionHandlers(first, second);

		await expect(
			composed({
				...request,
				action: { id: "open-streams", label: "Open streams" },
			}),
		).resolves.toBe(true);
		await expect(
			composed({
				...request,
				pluginId: "missing-plugin",
				action: { id: "ignored", label: "Ignored" },
			}),
		).resolves.toBe(false);

		expect(handled).toEqual(["second:open-streams"]);
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

	it("composes host context providers until one returns context", async () => {
		const first = createScopedHomesteadSurfaceContextProvider(
			{ pluginId: "other-plugin" },
			() => ({ hostId: "other" }),
		);
		const second = createScopedHomesteadSurfaceContextProvider(
			{ pluginId: "studio-stream-surface-demo" },
			() => ({ hostId: "apps/dev" }),
		);
		const composed = composeHomesteadSurfaceContextProviders(first, second);

		expect(await composed(request)).toEqual({ hostId: "apps/dev" });
		expect(
			await composed({
				...request,
				pluginId: "missing-plugin",
			}),
		).toBeUndefined();
	});
});
