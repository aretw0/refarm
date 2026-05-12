import { describe, expect, it } from "vitest";
import {
	assertHomesteadHostRendererConformance,
	HOMESTEAD_HOST_RENDERER_KINDS,
	requiredHomesteadHostRendererCapabilities,
	runHostRendererConformance,
} from "@refarm.dev/homestead/sdk/host-renderer";
import {
	REFARM_HEADLESS_RENDERER,
	REFARM_RENDERERS,
	REFARM_TUI_RENDERER,
	REFARM_WEB_RENDERER,
	resolveRefarmRenderer,
} from "../../src/renderers";

describe("refarm renderer catalog", () => {
	it("maps every shared renderer kind to a distro descriptor", () => {
		expect(REFARM_RENDERERS).toEqual({
			web: REFARM_WEB_RENDERER,
			tui: REFARM_TUI_RENDERER,
			headless: REFARM_HEADLESS_RENDERER,
		});

		for (const kind of HOMESTEAD_HOST_RENDERER_KINDS) {
			expect(resolveRefarmRenderer(kind)).toBe(REFARM_RENDERERS[kind]);
		}
	});

	it("conforms to Homestead renderer capability profiles", () => {
		for (const kind of HOMESTEAD_HOST_RENDERER_KINDS) {
			const report = runHostRendererConformance(kind, resolveRefarmRenderer);

			expect(report.requiredCapabilities).toEqual(
				requiredHomesteadHostRendererCapabilities(kind),
			);
			expect(report.renderer).toEqual(
				expect.objectContaining({
					id: `refarm-${kind}`,
					kind,
				}),
			);
			expect(report.passed).toBe(true);
			expect(report.issues).toEqual([]);
			expect(() =>
				assertHomesteadHostRendererConformance(report),
			).not.toThrow();
		}
	});
});
