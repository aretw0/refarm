import { describe, expect, it } from "vitest";

import { buildRefarmLaunchBanner, isRefarmBrandBannerEnabled, resolveBrandName } from "./brand.js";

describe("launch banner white-label (REFARM_BRAND_NAME)", () => {
	it("defaults to REFARM when unset", () => {
		expect(resolveBrandName({})).toBe("REFARM");
	});

	it("renames the banner to the resolved brand (uppercased)", () => {
		expect(resolveBrandName({ REFARM_BRAND_NAME: "govhub" })).toBe("GOVHUB");
		const banner = buildRefarmLaunchBanner("web", {
			version: "1.2.3",
			env: { REFARM_BRAND_NAME: "GovHub" },
		});
		expect(banner).toContain("GOVHUB");
		expect(banner).not.toContain("REFARM"); // no upstream name leaks to a judge
	});

	it("keeps the box border aligned across brand lengths (no broken frame)", () => {
		const lineWidths = (brand: string): number[] =>
			buildRefarmLaunchBanner("tui", { version: "0", env: { REFARM_BRAND_NAME: brand } })
				.split("\n")
				.slice(0, 4) // the 4 box lines
				// count display columns (the box-drawing chars are single-width)
				.map((line) => [...line].length);

		// Every box line is the SAME width regardless of brand length — the border,
		// the brand row, and the tagline row all align.
		for (const brand of ["a", "GovHub", "A-Very-Long-Brand-Name-That-Overflows"]) {
			const widths = lineWidths(brand);
			expect(new Set(widths).size).toBe(1); // all four lines equal width
		}
	});

	it("preserves the tagline and the version/launch-target lines", () => {
		const banner = buildRefarmLaunchBanner("web", {
			version: "9.9.9",
			env: { REFARM_BRAND_NAME: "GovHub" },
		});
		expect(banner).toContain("workspace automation");
		expect(banner).toContain("version: 9.9.9");
		expect(banner).toContain("launch target: web runtime");
	});

	it("the banner on/off toggle is independent of the name override", () => {
		// Disabling hides the banner; the name override only changes WHAT is shown.
		expect(isRefarmBrandBannerEnabled({ REFARM_BRAND_BANNER: "off" })).toBe(false);
		expect(isRefarmBrandBannerEnabled({ REFARM_BRAND_NAME: "GovHub" })).toBe(true);
	});
});
