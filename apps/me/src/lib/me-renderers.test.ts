import { describe, expect, it } from "vitest";
import { homesteadHostRendererCan } from "@refarm.dev/homestead/sdk/host-renderer";
import { REFARM_ME_RENDERERS, REFARM_ME_WEB_RENDERER } from "./me-renderers";

describe("refarm.me renderer catalog", () => {
	it("advertises the citizen web distro through the shared host contract", () => {
		expect(REFARM_ME_RENDERERS).toEqual([REFARM_ME_WEB_RENDERER]);
		expect(REFARM_ME_WEB_RENDERER).toEqual(
			expect.objectContaining({
				id: "refarm-me-web",
				kind: "web",
				label: "Refarm.me Web",
				metadata: { app: "apps/me" },
			}),
		);
		expect(homesteadHostRendererCan(REFARM_ME_WEB_RENDERER, "surfaces")).toBe(
			true,
		);
		expect(homesteadHostRendererCan(REFARM_ME_WEB_RENDERER, "rich-html")).toBe(
			true,
		);
	});
});
