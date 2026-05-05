import { describe, expect, it } from "vitest";
import { createHomesteadHostRendererDescriptor } from "@refarm.dev/homestead/sdk/host-renderer";
import {
	createStudioHeadlessSnapshot,
	STUDIO_HEADLESS_RENDERER,
} from "./studio-headless-runtime";

describe("studio headless runtime", () => {
	it("advertises a non-interactive headless renderer for automation", () => {
		expect(STUDIO_HEADLESS_RENDERER).toEqual(
			expect.objectContaining({
				id: "refarm-dev-headless",
				kind: "headless",
				label: "Refarm Studio Headless",
				metadata: { app: "apps/dev" },
			}),
		);
		expect(STUDIO_HEADLESS_RENDERER.capabilities).toContain("telemetry");
		expect(STUDIO_HEADLESS_RENDERER.capabilities).toContain("diagnostics");
		expect(STUDIO_HEADLESS_RENDERER.capabilities).not.toContain("interactive");
		expect(STUDIO_HEADLESS_RENDERER.capabilities).not.toContain("rich-html");
	});

	it("builds a renderer snapshot from semantic telemetry without DOM", () => {
		const snapshot = createStudioHeadlessSnapshot({
			telemetryEvents: [
				{
					event: "ui:surface_rejected",
					pluginId: "plugin-a",
					payload: {
						reason: "untrusted-plugin",
						surfaceId: "agent-panel",
						surfaceKind: "panel",
						slotId: "main",
						registryStatus: "registered",
					},
				},
				{
					event: "ui:surface_action_requested",
					pluginId: "plugin-b",
					payload: {
						actionId: "open-node",
						actionIntent: "navigate",
						surfaceId: "node-card",
					},
				},
			],
		});

		expect(snapshot.renderer).toBe(STUDIO_HEADLESS_RENDERER);
		expect(snapshot.missingCapabilities).toEqual([]);
		expect(snapshot.telemetryEvents).toEqual([
			"ui:surface_rejected",
			"ui:surface_action_requested",
		]);
		expect(snapshot.surfaces?.rejected).toEqual([
			expect.objectContaining({
				pluginId: "plugin-a",
				reason: "untrusted-plugin",
				surfaceId: "agent-panel",
			}),
		]);
		expect(snapshot.surfaces?.actions).toEqual([
			expect.objectContaining({
				pluginId: "plugin-b",
				status: "requested",
				actionId: "open-node",
				actionIntent: "navigate",
			}),
		]);
		expect(snapshot.diagnostics).toEqual([
			"renderer:non-interactive",
			"renderer:no-rich-html",
		]);
	});

	it("reports required capability gaps for narrowed headless profiles", () => {
		const renderer = createHomesteadHostRendererDescriptor(
			"audit-only",
			"headless",
			{
				capabilities: ["telemetry"],
			},
		);

		expect(
			createStudioHeadlessSnapshot({
				renderer,
				requiredCapabilities: ["telemetry", "diagnostics"],
			}),
		).toEqual(
			expect.objectContaining({
				missingCapabilities: ["diagnostics"],
				diagnostics: [
					"renderer:non-interactive",
					"renderer:no-rich-html",
					"renderer:missing:diagnostics",
				],
			}),
		);
	});
});
