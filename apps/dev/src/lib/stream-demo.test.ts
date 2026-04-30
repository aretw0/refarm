import { describe, expect, it, vi } from "vitest";
import {
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
});
