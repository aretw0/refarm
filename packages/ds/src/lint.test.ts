import { describe, expect, it } from "vitest";

import { runDsLint, type DsLintSnapshot } from "./lint.js";

const validSnapshot: DsLintSnapshot = {
	viewport: { width: 390, height: 844 },
	elements: [
		{
			id: "hero-title",
			selector: "main h1",
			tagName: "h1",
			text: "Refarm supply stack",
			styles: {
				color: "#f0f6fc",
				backgroundColor: "#0d1117",
				fontSizePx: 34,
				fontWeight: 800,
				fontSizeExpression: "clamp(2rem, 7vw, 3.5rem)",
			},
			metrics: {
				clientWidth: 342,
				scrollWidth: 342,
				clientHeight: 92,
				scrollHeight: 92,
				boundingBox: { x: 24, y: 120, width: 342, height: 92 },
			},
		},
		{
			id: "section-title",
			selector: "main h2",
			tagName: "h2",
			text: "Release blocks",
			styles: {
				color: "rgb(240, 246, 252)",
				backgroundColor: "rgb(13, 17, 23)",
				fontSizePx: 24,
				fontWeight: 700,
				fontSizeExpression: "clamp(1.5rem, 4vw, 2rem)",
			},
			metrics: {
				clientWidth: 342,
				scrollWidth: 342,
				boundingBox: { x: 24, y: 260, width: 342, height: 48 },
			},
		},
	],
};

describe("ds-lint:v1", () => {
	it("passes a rendered snapshot with accessible contrast, bounded boxes, fluid headings, and hierarchy", () => {
		const report = runDsLint(validSnapshot);

		expect(report.pass).toBe(true);
		expect(report.issues).toEqual([]);
	});

	it("flags generic UI gaffes without naming a product page", () => {
		const report = runDsLint({
			viewport: { width: 390, height: 844 },
			elements: [
				{
					id: "overgrown-title",
					selector: "main h1",
					tagName: "h1",
					text: "Refarm supplies the blocks downstream projects should not rebuild.",
					styles: {
						color: "#8b949e",
						backgroundColor: "#0d1117",
						fontSizePx: 56,
						fontWeight: 800,
						fontSizeExpression: "56px",
					},
					metrics: {
						clientWidth: 330,
						scrollWidth: 486,
						boundingBox: { x: 24, y: 96, width: 410, height: 164 },
					},
				},
				{
					id: "skipped-heading",
					selector: "main h3",
					tagName: "h3",
					text: "Details",
					styles: {
						color: "#f0f6fc",
						backgroundColor: "#0d1117",
						fontSizePx: 20,
						fontWeight: 700,
						fontSizeExpression: "clamp(1.2rem, 3vw, 1.5rem)",
					},
				},
			],
		});

		expect(report.pass).toBe(false);
		expect(report.issues.map((issue) => issue.ruleId)).toEqual([
			"ds-overflow",
			"ds-viewport-overflow",
			"ds-fluid-type",
			"ds-heading-hierarchy",
		]);
	});

	it("warns when a text pair cannot be concretely measured yet", () => {
		const report = runDsLint(
			{
				viewport: { width: 390, height: 844 },
				elements: [
					{
						id: "token-text",
						tagName: "p",
						text: "Token color not resolved by the collector.",
						styles: {
							color: "var(--foreground)",
							backgroundColor: "var(--background)",
							fontSizePx: 16,
						},
					},
				],
			},
			{ headingHierarchy: false },
		);

		expect(report.pass).toBe(true);
		expect(report.warningCount).toBe(1);
		expect(report.issues[0]?.ruleId).toBe("ds-contrast");
	});
});
