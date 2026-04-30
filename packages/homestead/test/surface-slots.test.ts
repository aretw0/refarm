import { createMockManifest } from "@refarm.dev/plugin-manifest";
import { describe, expect, it } from "vitest";
import { resolveHomesteadSurfaceSlots } from "../src/sdk/surface-slots";

describe("resolveHomesteadSurfaceSlots", () => {
	it("combines legacy UI slots with homestead extension surfaces", () => {
		const manifest = createMockManifest({
			ui: { slots: ["main", "statusbar", "main"] },
			extensions: {
				surfaces: [
					{
						layer: "homestead",
						kind: "panel",
						id: "stream-panel",
						slot: "main",
					},
					{
						layer: "homestead",
						kind: "panel",
						id: "activity-panel",
						slot: "activity",
					},
					{
						layer: "automation",
						kind: "workflow-step",
						id: "ignored",
						slot: "automation",
					},
				],
			},
		});

		expect(resolveHomesteadSurfaceSlots(manifest)).toEqual([
			"main",
			"statusbar",
			"activity",
		]);
	});
});
