import { describe, expect, it } from "vitest";
import {
	assertHomesteadHostRendererConformance,
	checkHomesteadHostRendererConformance,
	createHomesteadHostRendererDescriptor,
	HOMESTEAD_HOST_RENDERER_KINDS,
	requiredHomesteadHostRendererCapabilities,
	runHostRendererConformance,
	summarizeHomesteadHostSurfaceState,
} from "./host-renderer";

describe("Homestead host renderer conformance", () => {
	it("defines required capabilities for every renderer kind", () => {
		expect(requiredHomesteadHostRendererCapabilities("web")).toEqual([
			"surfaces",
			"surface-actions",
			"host-context",
			"streams",
			"telemetry",
			"diagnostics",
			"interactive",
			"rich-html",
		]);
		expect(requiredHomesteadHostRendererCapabilities("tui")).toEqual([
			"surfaces",
			"surface-actions",
			"host-context",
			"streams",
			"telemetry",
			"diagnostics",
			"interactive",
		]);
		expect(requiredHomesteadHostRendererCapabilities("headless")).toEqual([
			"surfaces",
			"surface-actions",
			"host-context",
			"streams",
			"telemetry",
			"diagnostics",
		]);
	});

	it("passes default descriptors for web, tui, and headless", () => {
		for (const kind of HOMESTEAD_HOST_RENDERER_KINDS) {
			const report = runHostRendererConformance(kind, (rendererKind) =>
				createHomesteadHostRendererDescriptor(
					`refarm-${rendererKind}`,
					rendererKind,
				),
			);

			expect(report).toMatchObject({
				passed: true,
				expectedKind: kind,
				renderer: { id: `refarm-${kind}`, kind },
				issues: [],
			});
			expect(() =>
				assertHomesteadHostRendererConformance(report),
			).not.toThrow();
		}
	});

	it("reports missing required capabilities", () => {
		const renderer = createHomesteadHostRendererDescriptor("thin-web", "web", {
			capabilities: ["diagnostics"],
		});

		const report = checkHomesteadHostRendererConformance(renderer, "web");

		expect(report.passed).toBe(false);
		expect(report.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "missing-required-capability",
					capability: "surfaces",
				}),
				expect.objectContaining({
					code: "missing-required-capability",
					capability: "rich-html",
				}),
			]),
		);
		expect(() => assertHomesteadHostRendererConformance(report)).toThrow(
			/thin-web failed web conformance/,
		);
	});

	it("reports renderer kind mismatch", () => {
		const renderer = createHomesteadHostRendererDescriptor("wrong", "headless");

		const report = checkHomesteadHostRendererConformance(renderer, "web");

		expect(report.passed).toBe(false);
		expect(report.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "renderer-kind-mismatch",
					expectedKind: "web",
					actualKind: "headless",
				}),
			]),
		);
	});
});

describe("Homestead host surface state summary", () => {
	it("defaults all surface counts to zero", () => {
		expect(summarizeHomesteadHostSurfaceState(undefined)).toEqual({
			mounted: 0,
			rejected: 0,
			availableActions: 0,
			actionEvents: 0,
			surfaceActions: 0,
		});
	});

	it("prefers available action affordances over historical telemetry events", () => {
		expect(
			summarizeHomesteadHostSurfaceState({
				mounted: [
					{
						pluginId: "plugin-a",
						slotId: "main",
						mountSource: "extension-surface",
					},
				],
				rejected: [{ reason: "untrusted-plugin", pluginId: "plugin-b" }],
				availableActions: [
					{
						id: "open-node",
						label: "Open node",
						intent: "node:open",
					},
				],
				actions: [
					{ actionId: "historical-open", status: "requested" },
					{ actionId: "historical-close", status: "failed" },
				],
			}),
		).toEqual({
			mounted: 1,
			rejected: 1,
			availableActions: 1,
			actionEvents: 2,
			surfaceActions: 1,
		});
	});

	it("falls back to historical action telemetry when no affordance snapshot exists", () => {
		expect(
			summarizeHomesteadHostSurfaceState({
				actions: [
					{ actionId: "historical-open", status: "requested" },
					{ actionId: "historical-close", status: "failed" },
				],
			}),
		).toMatchObject({
			actionEvents: 2,
			surfaceActions: 2,
		});
	});
});
