import { describe, expect, it, vi } from "vitest";
import {
	buildRefarmLaunchBanner,
	isRefarmBrandBannerEnabled,
	printRefarmLaunchBanner,
} from "../../src/commands/brand.js";

describe("brand banner", () => {
	it("enables banner by default", () => {
		expect(isRefarmBrandBannerEnabled({})).toBe(true);
	});

	it("disables banner when REFARM_BRAND_BANNER is falsy string", () => {
		expect(isRefarmBrandBannerEnabled({ REFARM_BRAND_BANNER: "0" })).toBe(
			false,
		);
		expect(isRefarmBrandBannerEnabled({ REFARM_BRAND_BANNER: "false" })).toBe(
			false,
		);
	});

	it("builds deterministic launch banner per experience", () => {
		expect(buildRefarmLaunchBanner("web", { version: "1.2.3" })).toContain(
			"launch target: web runtime",
		);
		expect(buildRefarmLaunchBanner("tui", { version: "1.2.3" })).toContain(
			"launch target: tui runtime",
		);
		expect(buildRefarmLaunchBanner("web", { version: "1.2.3" })).toContain(
			"REFARM",
		);
		expect(buildRefarmLaunchBanner("web", { version: "1.2.3" })).toContain(
			"version: 1.2.3",
		);
	});

	it("prints banner only when enabled", () => {
		const log = vi.fn();
		const printed = printRefarmLaunchBanner("web", {
			env: { REFARM_BRAND_BANNER: "1" },
			log,
		});
		expect(printed).toBe(true);
		expect(log).toHaveBeenCalledWith(expect.stringContaining("launch target"));

		const disabledLog = vi.fn();
		const skipped = printRefarmLaunchBanner("tui", {
			env: { REFARM_BRAND_BANNER: "off" },
			log: disabledLog,
		});
		expect(skipped).toBe(false);
		expect(disabledLog).not.toHaveBeenCalled();
	});
});
