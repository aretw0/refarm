import { describe, expect, it, vi } from "vitest";
import {
	mountStudioStreamDemoControl,
	seedStudioStreamDemo,
	shouldSeedStudioStreamDemo,
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

	it("mounts a visible toggle control in the Studio statusbar", () => {
		const container = document.createElement("div");
		const onToggle = vi.fn();

		const button = mountStudioStreamDemoControl(container, {
			enabled: false,
			onToggle,
		});

		expect(button.textContent).toBe("Enable Studio stream demo");
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
