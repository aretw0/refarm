import { describe, expect, it, vi } from "vitest";
import {
	createStudioStreamSurfaceContextProvider,
	createStudioStreamSurfaceDemoPlugin,
	mountStudioStreamDemoControl,
	renderStudioStreamSurfaceDemo,
	seedStudioStreamDemo,
	shouldSeedStudioStreamDemo,
	STUDIO_STREAM_SURFACE_PLUGIN_ID,
	studioStreamDemoNodes,
} from "./stream-demo";

describe("Studio stream demo seeding", () => {
	it("is opt-in through URL or persisted Studio flag", () => {
		expect(shouldSeedStudioStreamDemo("/", null)).toBe(false);
		expect(shouldSeedStudioStreamDemo("/?stream-demo", null)).toBe(true);
		expect(shouldSeedStudioStreamDemo("/?streamDemo=1", null)).toBe(true);
		expect(shouldSeedStudioStreamDemo("/", "1")).toBe(true);
	});

	it("creates generic stream observation nodes for Homestead", () => {
		const nodes = studioStreamDemoNodes(new Date("2026-04-30T10:00:00.000Z"));

		expect(nodes.map((node) => node["@type"])).toEqual([
			"StreamSession",
			"StreamChunk",
			"StreamChunk",
		]);
		expect(nodes[0]).toMatchObject({
			stream_ref: "urn:tractor:stream:agent-response:studio-demo",
			status: "active",
			metadata: { prompt_ref: "studio-demo", model: "apps-dev" },
		});
	});

	it("stores demo nodes without requiring signing", async () => {
		const storeNode = vi.fn().mockResolvedValue(undefined);

		await seedStudioStreamDemo({ storeNode } as any);

		expect(storeNode).toHaveBeenCalledTimes(3);
		expect(storeNode).toHaveBeenCalledWith(
			expect.objectContaining({ "@type": "StreamSession" }),
			"none",
		);
	});

	it("creates a Homestead surface plugin for the Studio stream demo", async () => {
		const plugin = createStudioStreamSurfaceDemoPlugin();

		expect(plugin.id).toBe(STUDIO_STREAM_SURFACE_PLUGIN_ID);
		expect(plugin.state).toBe("running");
		expect(plugin.manifest.extensions?.surfaces).toEqual([
			expect.objectContaining({
				layer: "homestead",
				kind: "panel",
				id: "studio-stream-panel",
				slot: "streams",
				capabilities: ["ui:panel:render", "ui:stream:read"],
			}),
		]);

		const rendered = await plugin.call("renderHomesteadSurface", {
			pluginId: STUDIO_STREAM_SURFACE_PLUGIN_ID,
			slotId: "streams",
			mountSource: "extension-surface",
			surface: plugin.manifest.extensions?.surfaces?.[0],
			locale: "en",
		});
		expect(rendered).toMatchObject({
			html: expect.stringContaining(
				'data-refarm-studio-stream-surface="studio-stream-panel"',
			),
		});
	});

	it("renders escaped executable stream surface markup", () => {
		const rendered = renderStudioStreamSurfaceDemo({
			pluginId: STUDIO_STREAM_SURFACE_PLUGIN_ID,
			slotId: "<streams>",
			mountSource: "extension-surface",
			surface: {
				layer: "homestead",
				kind: "panel",
				id: 'studio-"stream"-panel',
				slot: "streams",
			},
			locale: "en",
		});

		expect(rendered).toMatchObject({
			html: expect.stringContaining("studio-&quot;stream&quot;-panel"),
		});
		expect((rendered as { html: string }).html).toContain("&lt;streams&gt;");
	});

	it("renders host-owned context and actions in the executable stream surface", () => {
		const provider = createStudioStreamSurfaceContextProvider({
			baseUrl: "/studio/",
		});
		const host = provider({
			pluginId: STUDIO_STREAM_SURFACE_PLUGIN_ID,
			slotId: "streams",
			mountSource: "extension-surface",
			surface: {
				layer: "homestead",
				kind: "panel",
				id: "studio-stream-panel",
				slot: "streams",
			},
			locale: "en",
		});

		expect(host).toMatchObject({
			hostId: "apps/dev",
			data: {
				streamRef: "urn:tractor:stream:agent-response:studio-demo",
			},
			actions: [
				expect.objectContaining({
					id: "open-stream-workbench",
					intent: "studio:navigate",
					payload: { href: "/studio/streams?stream-demo" },
				}),
			],
		});

		const rendered = renderStudioStreamSurfaceDemo({
			pluginId: STUDIO_STREAM_SURFACE_PLUGIN_ID,
			slotId: "streams",
			mountSource: "extension-surface",
			surface: {
				layer: "homestead",
				kind: "panel",
				id: "studio-stream-panel",
				slot: "streams",
			},
			locale: "en",
			host: host as any,
		});

		expect((rendered as { html: string }).html).toContain("apps/dev");
		expect((rendered as { html: string }).html).toContain(
			"open-stream-workbench",
		);
		expect((rendered as { html: string }).html).toContain(
			"/studio/streams?stream-demo",
		);
	});

	it("keeps Studio stream surface context scoped to the demo plugin", () => {
		const provider = createStudioStreamSurfaceContextProvider();

		expect(
			provider({
				pluginId: "other-plugin",
				slotId: "streams",
				mountSource: "extension-surface",
				surface: {
					layer: "homestead",
					kind: "panel",
					id: "studio-stream-panel",
					slot: "streams",
				},
				locale: "en",
			}),
		).toBeUndefined();
	});

	it("mounts a visible toggle control in the Studio statusbar", () => {
		const container = document.createElement("div");
		const onToggle = vi.fn();

		const button = mountStudioStreamDemoControl(container, {
			enabled: false,
			onToggle,
		});

		expect(button.textContent).toBe("Enable Studio stream demo");
		expect(button.className).toContain("refarm-btn");
		expect(button.className).toContain("refarm-btn-pill");
		expect(button.getAttribute("aria-pressed")).toBe("false");
		button.click();
		expect(onToggle).toHaveBeenCalledTimes(1);

		const replacement = mountStudioStreamDemoControl(container, {
			enabled: true,
			onToggle,
		});
		expect(
			container.querySelectorAll("[data-refarm-studio-stream-demo]"),
		).toHaveLength(1);
		expect(replacement.textContent).toBe("Disable Studio stream demo");
		expect(replacement.getAttribute("aria-pressed")).toBe("true");
	});
});
