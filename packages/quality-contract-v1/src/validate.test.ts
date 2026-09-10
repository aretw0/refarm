import { describe, expect, it } from "vitest";

import { createRegexQualityChecker } from "./reference.js";
import { runQualityCheck } from "./report.js";
import { isQualityReport, validateQualityReport } from "./validate.js";

const profile = {
	name: "writing",
	rules: [
		{
			id: "generic",
			severity: "warn",
			description: "Avoid generic conclusions.",
			check: { type: "regex", pattern: "generic", flags: "i" },
		},
	],
};

describe("validateQualityReport", () => {
	it("accepts what runQualityCheck produces", async () => {
		const report = await runQualityCheck(createRegexQualityChecker(), "a generic ending", profile);
		expect(validateQualityReport(report)).toEqual({ ok: true, issues: [] });
		expect(isQualityReport(report)).toBe(true);
	});

	it("accepts an envelope written by another producer, in another language", () => {
		// Exactly the shape a Python engine wrote to disk: plain JSON, no class instances.
		const report = JSON.parse(
			JSON.stringify({
				capability: "quality:v1",
				checkerId: "arch-engine.validator",
				domain: "physical-design",
				profileName: "eco-house-demo",
				findings: [
					{ severity: "warn", ruleId: "material.origem_local", message: "not local", locus: { material: "tinta" } },
				],
				counts: { warn: 1 },
				metrics: { custo_total: 40224.33 },
			}),
		);
		expect(validateQualityReport(report).ok).toBe(true);
	});

	it("names the path of every defect", () => {
		const result = validateQualityReport({
			capability: "quality:v2",
			checkerId: "",
			domain: "text",
			profileName: "p",
			findings: [{ severity: "fail", ruleId: "r" }, "not-a-finding"],
			counts: { fail: 2, warn: 1 },
			metrics: 3,
		});
		expect(result.ok).toBe(false);
		expect(result.issues.map((issue) => issue.path)).toEqual([
			"$.capability",
			"$.checkerId",
			"$.findings.0.message",
			"$.findings.1",
			"$.counts.fail",
			"$.counts.warn",
			"$.metrics",
		]);
	});

	it("rejects counts that do not tally the findings, in both directions", () => {
		const base = {
			capability: "quality:v1",
			checkerId: "c",
			domain: "d",
			profileName: "p",
			findings: [{ severity: "notice", ruleId: "r", message: "m" }],
		};
		expect(validateQualityReport({ ...base, counts: {} }).issues).toEqual([
			{ path: "$.counts.notice", message: "Missing severity present in findings." },
		]);
		expect(validateQualityReport({ ...base, counts: { notice: 1, fail: 0 } }).ok).toBe(true);
		expect(validateQualityReport({ ...base, counts: { notice: -1 } }).issues[0]?.path).toBe("$.counts.notice");
	});

	it("rejects non-objects without throwing", () => {
		for (const value of [null, undefined, 42, "report", []]) {
			expect(validateQualityReport(value)).toEqual({
				ok: false,
				issues: [{ path: "$", message: "Expected a quality report object." }],
			});
		}
	});
});
