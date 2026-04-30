import { describe, expect, it, vi } from "vitest";
import {
	createStudioStreamSurfaceDemoPlugin,
	mountStudioStreamDemoControl,
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

	it("creates a Homestead surface plugin for the Studio stream demo", () => {
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
		expect(container.querySelectorAll("[data-refarm-studio-stream-demo]")).toHaveLength(1);
		expect(replacement.textContent).toBe("Disable Studio stream demo");
		expect(replacement.getAttribute("aria-pressed")).toBe("true");
	});
});
