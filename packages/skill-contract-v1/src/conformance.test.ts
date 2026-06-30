import { describe, expect, it } from "vitest";

import {
	MISSING_CAPABILITIES_SKILL_MARKDOWN_FIXTURE,
	VALID_SKILL_MARKDOWN_FIXTURE,
	runSkillContractV1Conformance,
} from "./conformance.js";
import {
	createSkillContractV1Adapter,
	parseSkillMarkdown,
	validateSkillManifest,
} from "./manifest.js";

describe("skill-contract-v1", () => {
	it("parses SKILL.md into a policy-checkable manifest", () => {
		const result = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE, {
			sourceUri: "fixture:refarm-git-workflow/SKILL.md",
		});

		expect(result.ok).toBe(true);
		expect(result.issues).toEqual([]);
		expect(result.manifest).toMatchObject({
			schema: "refarm.skill-manifest.v1",
			name: "refarm-git-workflow",
			source: {
				format: "SKILL.md",
				uri: "fixture:refarm-git-workflow/SKILL.md",
			},
			capabilities: {
				requires: ["refarm.operator-loop", "refarm.git.write"],
				optional: ["refarm.github.pr"],
			},
			policy: {
				executionMode: "plan-only",
				toolAccess: "declared-capabilities-only",
			},
		});
		expect(result.manifest?.source.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(result.manifest?.id).toMatch(/^urn:refarm:skill:v1:refarm-git-workflow:/);
	});

	it("fails closed when SKILL.md has no required capabilities", () => {
		const result = parseSkillMarkdown(MISSING_CAPABILITIES_SKILL_MARKDOWN_FIXTURE);

		expect(result.ok).toBe(false);
		expect(result.manifest).toBeNull();
		expect(result.issues).toContainEqual({
			code: "CAPABILITY_LIST_EMPTY",
			path: "$.capabilities.requires",
			message: "Expected at least one required capability.",
		});
	});

	it("validates manifest source, instructions, and capability envelope", () => {
		const parsed = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE);
		expect(parsed.manifest).not.toBeNull();

		const invalid = {
			...parsed.manifest,
			source: {
				...parsed.manifest?.source,
				sha256: "not-a-hash",
			},
			capabilities: {
				requires: [],
			},
			instructions: "",
		};

		expect(validateSkillManifest(invalid)).toMatchObject({
			ok: false,
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "SOURCE_SHA256_INVALID" }),
				expect.objectContaining({ code: "CAPABILITY_LIST_EMPTY" }),
				expect.objectContaining({ code: "STRING_EMPTY", path: "$.instructions" }),
			]),
		});
	});

	it("passes the conformance suite with the reference adapter", async () => {
		const result = await runSkillContractV1Conformance(createSkillContractV1Adapter());

		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
		expect(result.failures).toEqual([]);
		expect(result.total).toBe(4);
	});
});
