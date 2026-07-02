import { describe, expect, it } from "vitest";

import {
	createRegexQualityChecker,
	resolveQualityProfile,
	runQualityCheck,
	runQualityV1Conformance,
	type QualityChecker,
	type QualityProfile,
} from "./index.js";

describe("quality:v1 conformance", () => {
	it("passes for the reference regex checker", async () => {
		const result = await runQualityV1Conformance(createRegexQualityChecker());

		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
	});

	it("composes profiles with child rules overriding parent rules by id", () => {
		const base: QualityProfile = {
			name: "base",
			rules: [
				{
					id: "generic",
					severity: "info",
					description: "base",
					check: { type: "regex", pattern: "generic" },
				},
			],
		};
		const strict: QualityProfile = {
			name: "strict",
			extends: "base",
			rules: [
				{
					id: "generic",
					severity: "fail",
					description: "strict",
					check: { type: "regex", pattern: "generic" },
				},
				{
					id: "vague",
					severity: "warn",
					description: "vague",
					check: { type: "regex", pattern: "things" },
				},
			],
		};

		const resolved = resolveQualityProfile(strict, { base });

		expect(resolved.rules).toHaveLength(2);
		expect(resolved.rules.find((rule) => rule.id === "generic")?.severity).toBe("fail");
	});

	it("runs a text profile and counts open severities", async () => {
		const checker = createRegexQualityChecker();
		const report = await runQualityCheck(checker, "generic things and generic endings", {
			name: "writing",
			rules: [
				{
					id: "generic",
					severity: "notice",
					description: "Avoid generic wording.",
					check: { type: "regex", pattern: "generic" },
				},
				{
					id: "things",
					severity: "warn",
					description: "Name the thing directly.",
					check: { type: "regex", pattern: "things" },
				},
			],
		});

		expect(report.capability).toBe("quality:v1");
		expect(report.findings.map((finding) => finding.ruleId)).toEqual([
			"generic",
			"generic",
			"things",
		]);
		expect(report.counts).toEqual({ notice: 2, warn: 1 });
	});

	it("accepts the spec's regex field name without adding a second public checker API", async () => {
		const checker = createRegexQualityChecker();
		const report = await runQualityCheck(checker, "generic", {
			name: "writing",
			rules: [
				{
					id: "generic",
					severity: "warn",
					description: "Avoid generic wording.",
					check: { type: "regex", regex: "generic" },
				},
			],
		});

		expect(report.findings).toHaveLength(1);
		expect(report.findings[0]?.ruleId).toBe("generic");
	});

	it("reports actionable failures for incompatible checkers", async () => {
		const checker: QualityChecker<string> = {
			checkerId: "",
			domain: "",
			check: () => [{ severity: "", ruleId: "", message: "" }],
		};

		const result = await runQualityV1Conformance(checker);

		expect(result.pass).toBe(false);
		expect(result.failures).toContain("checker.checkerId must be a non-empty string");
		expect(result.failures).toContain("checker.domain must be a non-empty string");
		expect(result.failures).toContain("findings[].ruleId must be a non-empty string");
	});
});
