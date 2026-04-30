import { createMockManifest } from "@refarm.dev/plugin-manifest";
import { describe, expect, it } from "vitest";
import {
	resolveHomesteadSurfaceMounts,
	resolveHomesteadSurfaceSlots,
} from "../src/sdk/surface-slots";

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
		expect(resolveHomesteadSurfaceMounts(manifest)).toMatchObject([
			{ slotId: "main", source: "legacy-ui-slot" },
			{ slotId: "statusbar", source: "legacy-ui-slot" },
			{
				slotId: "main",
				source: "extension-surface",
				surface: { id: "stream-panel", kind: "panel" },
			},
			{
				slotId: "activity",
				source: "extension-surface",
				surface: { id: "activity-panel", kind: "panel" },
			},
		]);
	});

	it("ignores homestead surfaces that require unauthorized capabilities", () => {
		const manifest = createMockManifest({
			ui: { slots: ["statusbar"] },
			extensions: {
				surfaces: [
					{
						layer: "homestead",
						kind: "panel",
						id: "authorized-stream-panel",
						slot: "streams",
						capabilities: ["ui:stream:read"],
					},
					{
						layer: "homestead",
						kind: "panel",
						id: "unauthorized-secrets-panel",
						slot: "secrets",
						capabilities: ["ui:secrets:read"],
					},
				],
			},
		});

		expect(resolveHomesteadSurfaceSlots(manifest)).toEqual([
			"statusbar",
			"streams",
		]);
		expect(
			resolveHomesteadSurfaceSlots(manifest, {
				allowedCapabilities: ["ui:secrets:read"],
			}),
		).toEqual(["statusbar", "secrets"]);
	});
});
