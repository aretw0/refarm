import { runQualityV1Conformance, type QualityProfile } from "@refarm.dev/quality-contract-v1";
import { describe, expect, it } from "vitest";

import { type DsLintSnapshot } from "./lint.js";
import { createDsQualityChecker, profileToDsLintOptions } from "./quality-checker.js";

const lowContrast: DsLintSnapshot = {
	viewport: { width: 390, height: 844 },
	elements: [
		{
			id: "lead",
			selector: "p.lead",
			tagName: "p",
			text: "Hard to read",
			styles: {
				color: "#777777",
				backgroundColor: "#888888",
				fontSizePx: 16,
				fontWeight: 400,
			},
		},
	],
};

const uiProfile: QualityProfile = {
	name: "ui-default",
	rules: [
		{
			id: "contrast-aa",
			severity: "fail",
			description: "Text contrast should meet WCAG AA.",
			check: { type: "contrast" },
		},
	],
};

describe("createDsQualityChecker", () => {
	it("wraps ds-lint as a quality:v1 ui checker", () => {
		const checker = createDsQualityChecker();

		expect(checker.checkerId).toBe("ds-lint");
		expect(checker.domain).toBe("ui");
	});

	it("maps ds-lint contrast issues into quality:v1 findings", () => {
		const findings = createDsQualityChecker().check(lowContrast, uiProfile);

		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({
			severity: "fail",
			ruleId: "ds-contrast",
			locus: {
				elementId: "lead",
				selector: "p.lead",
			},
		});
	});

	it("runs only the ds-lint rule families selected by the profile", () => {
		const overflowOnly: QualityProfile = {
			name: "ui-overflow-only",
			rules: [
				{
					id: "no-overflow",
					severity: "fail",
					description: "Elements must not overflow their containers.",
					check: { type: "overflow" },
				},
			],
		};

		expect(profileToDsLintOptions(overflowOnly)).toEqual({
			contrast: false,
			overflow: true,
			fluidType: false,
			headingHierarchy: false,
		});
		expect(createDsQualityChecker().check(lowContrast, overflowOnly)).toEqual([]);
	});

	it("conforms to the quality:v1 checker envelope", async () => {
		const baseProfile: QualityProfile = {
			name: "base-ui",
			rules: [
				{
					id: "ds-contrast",
					severity: "fail",
					description: "Text contrast should meet WCAG AA.",
					check: { type: "contrast" },
				},
			],
		};
		const strictProfile: QualityProfile = {
			name: "strict-ui",
			extends: "base-ui",
			rules: [],
		};
		const result = await runQualityV1Conformance(createDsQualityChecker(), {
			subject: lowContrast,
			profile: strictProfile,
			profiles: { "base-ui": baseProfile },
			expectedRuleId: "ds-contrast",
		});

		expect(result.pass, JSON.stringify(result.failures)).toBe(true);
	});
});
