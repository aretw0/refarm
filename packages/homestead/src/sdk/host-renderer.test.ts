import { describe, expect, it } from "vitest";
import {
	assertHomesteadHostRendererConformance,
	checkHomesteadHostRendererConformance,
	createHomesteadHostRendererDescriptor,
	HOMESTEAD_HOST_RENDERER_KINDS,
	requiredHomesteadHostRendererCapabilities,
	runHostRendererConformance,
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
