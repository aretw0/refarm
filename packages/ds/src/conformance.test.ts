import { describe, expect, it } from "vitest";

import { runDsThemeConformance } from "./conformance.js";
import { REQUIRED_TOKENS, type DsTheme } from "./contract.js";

function completeTheme(): DsTheme {
	return Object.fromEntries(REQUIRED_TOKENS.map((token) => [token, "x"])) as DsTheme;
}

describe("ds-tokens:v1 conformance", () => {
	it("passes for a theme defining every required token", () => {
		const result = runDsThemeConformance(completeTheme());
		expect(result.pass).toBe(true);
		expect(result.total).toBe(REQUIRED_TOKENS.length);
		expect(result.failed).toBe(0);
		expect(result.missing).toEqual([]);
	});

	it("reports the exact missing tokens", () => {
		const theme = completeTheme();
		delete (theme as Record<string, string>).primary;
		delete (theme as Record<string, string>)["radius-md"];
		const result = runDsThemeConformance(theme);
		expect(result.pass).toBe(false);
		expect(result.missing).toContain("primary");
		expect(result.missing).toContain("radius-md");
	});
});
