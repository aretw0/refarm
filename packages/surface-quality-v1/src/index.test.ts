import { describe, expect, it } from "vitest";

import {
	checkSurfaceQuality,
	createSurfaceQualityProfile,
	type SurfaceModality,
	type SurfaceQualityEvidence,
} from "./index.js";

function passingEvidence(modality: SurfaceModality): SurfaceQualityEvidence[] {
	return createSurfaceQualityProfile(modality).rules.map((rule) => ({
		id: rule.id,
		status: "pass",
		proof: `test:${rule.id}`,
	}));
}

describe("surface quality profiles", () => {
	it("keeps common requirements and adds modality-native evidence", () => {
		for (const modality of ["web", "terminal", "chat"] as const) {
			const ids = createSurfaceQualityProfile(modality).rules.map((rule) => rule.id);
			expect(ids).toContain("locale-fallback");
			expect(ids).toContain("primary-journey");
			expect(ids.some((id) => id.startsWith(`${modality}-`))).toBe(true);
		}
	});

	it("accepts complete evidence from every modality under quality:v1", async () => {
		for (const modality of ["web", "terminal", "chat"] as const) {
			const report = await checkSurfaceQuality(modality, passingEvidence(modality));
			expect(report.capability).toBe("quality:v1");
			expect(report.profileName).toBe(`surface-quality.v1:${modality}`);
			expect(report.findings).toEqual([]);
		}
	});

	it("reports missing, failed, empty, duplicated, and unjustified N/A evidence", async () => {
		const evidence = passingEvidence("web").filter((item) => item.id !== "web-reflow");
		evidence.find((item) => item.id === "primary-journey")!.status = "fail";
		evidence.find((item) => item.id === "visible-feedback")!.proof = "";
		evidence.find((item) => item.id === "web-keyboard")!.status = "not-applicable";
		evidence.push({ id: "non-color-meaning", status: "pass", proof: "duplicate" });
		const report = await checkSurfaceQuality("web", evidence);
		const ids = report.findings.map((finding) => finding.ruleId);
		expect(ids).toEqual(expect.arrayContaining([
			"web-reflow",
			"primary-journey",
			"visible-feedback",
			"web-keyboard",
			"non-color-meaning",
		]));
	});

	it("allows a bounded N/A only where the profile declares it", async () => {
		const evidence = passingEvidence("chat");
		const review = evidence.find((item) => item.id === "consequential-review")!;
		review.status = "not-applicable";
		review.proof = "This read-only surface exposes no consequential action.";
		expect((await checkSurfaceQuality("chat", evidence)).findings).toEqual([]);
	});
});
