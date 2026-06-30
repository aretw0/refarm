import { describe, expect, it } from "vitest";

import {
	MISSING_CAPABILITIES_SKILL_MARKDOWN_FIXTURE,
	VALID_SKILL_MARKDOWN_FIXTURE,
	runSkillContractV1Conformance,
} from "./conformance.js";
import {
	buildSkillInvocationPlan,
	buildSkillInvocationRequest,
	createSkillContractV1Adapter,
	createSkillSourceRef,
	parseSkillMarkdown,
	prepareSkillInvocationPlan,
	validateSkillInvocationPlan,
	validateSkillInvocationRequest,
	validateSkillManifest,
	verifySkillSource,
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
			engineBindings: {
				requires: ["runtime-agent", "source:v1"],
			},
			policy: {
				executionMode: "plan-only",
				toolAccess: "declared-capabilities-only",
			},
			io: {
				input: {
					format: "text/markdown",
					required: true,
					description: "Markdown task context for the host to inspect before planning git workflow steps.",
				},
				output: {
					format: "text/markdown",
					description: "Markdown plan describing the proposed git workflow steps.",
				},
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
			engineBindings: {
				requires: ["bad engine"],
			},
			io: {
				input: {
					format: "application/json",
					required: "yes",
				},
				output: {},
			},
			instructions: "",
		};

		expect(validateSkillManifest(invalid)).toMatchObject({
			ok: false,
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "SOURCE_SHA256_INVALID" }),
				expect.objectContaining({ code: "CAPABILITY_LIST_EMPTY" }),
				expect.objectContaining({ code: "ENGINE_BINDING_ID_INVALID" }),
				expect.objectContaining({ code: "VALUE_INVALID", path: "$.io.input.format" }),
				expect.objectContaining({ code: "INPUT_REQUIRED_INVALID" }),
				expect.objectContaining({ code: "VALUE_INVALID", path: "$.io.output.format" }),
				expect.objectContaining({ code: "STRING_EMPTY", path: "$.instructions" }),
			]),
		});
	});

	it("verifies loaded SKILL.md source integrity against a manifest source ref", () => {
		const expected = createSkillSourceRef(VALID_SKILL_MARKDOWN_FIXTURE, {
			sourceUri: "fixture:refarm-git-workflow/SKILL.md",
		});

		const result = verifySkillSource(VALID_SKILL_MARKDOWN_FIXTURE, expected, {
			sourceUri: "fixture:refarm-git-workflow/SKILL.md",
		});

		expect(result.ok).toBe(true);
		expect(result.issues).toEqual([]);
		expect(result.actual).toEqual(expected);
	});

	it("rejects loaded SKILL.md source when hash, bytes, or uri drift", () => {
		const expected = createSkillSourceRef(VALID_SKILL_MARKDOWN_FIXTURE, {
			sourceUri: "fixture:refarm-git-workflow/SKILL.md",
		});

		const result = verifySkillSource(`${VALID_SKILL_MARKDOWN_FIXTURE}\nChanged`, expected, {
			sourceUri: "fixture:other/SKILL.md",
		});

		expect(result).toMatchObject({
			ok: false,
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "SOURCE_SHA256_MISMATCH" }),
				expect.objectContaining({ code: "SOURCE_BYTES_MISMATCH" }),
				expect.objectContaining({ code: "SOURCE_URI_MISMATCH" }),
			]),
		});
	});

	it("builds a host-policy-checkable invocation plan", () => {
		const parsed = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE, {
			sourceUri: "fixture:refarm-git-workflow/SKILL.md",
		});
		expect(parsed.manifest).not.toBeNull();

		const result = buildSkillInvocationPlan(parsed.manifest!);

		expect(result.ok).toBe(true);
		expect(result.issues).toEqual([]);
		expect(result.plan).toMatchObject({
			schema: "refarm.skill-invocation-plan.v1",
			skill: {
				id: parsed.manifest?.id,
				name: "refarm-git-workflow",
				source: {
					format: "SKILL.md",
					uri: "fixture:refarm-git-workflow/SKILL.md",
				},
			},
			policy: {
				executionMode: "plan-only",
				toolAccess: "declared-capabilities-only",
			},
			capabilityRequests: [
				{ id: "refarm.operator-loop", required: true },
				{ id: "refarm.git.write", required: true },
				{ id: "refarm.github.pr", required: false },
			],
			engineBindings: {
				requires: ["runtime-agent", "source:v1"],
			},
			io: {
				input: {
					format: "text/markdown",
					required: true,
				},
				output: {
					format: "text/markdown",
				},
			},
			requiresHostPolicyApproval: true,
		});
		expect(result.plan?.instructions).toContain("Start with the operator loop");
	});

	it("rejects invocation plans that bypass host policy approval", () => {
		const parsed = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE);
		const built = buildSkillInvocationPlan(parsed.manifest!);
		expect(built.plan).not.toBeNull();

		const result = validateSkillInvocationPlan({
			...built.plan,
			requiresHostPolicyApproval: false,
		});

		expect(result).toMatchObject({
			ok: false,
			issues: expect.arrayContaining([
				expect.objectContaining({
					code: "INVOCATION_POLICY_APPROVAL_REQUIRED",
					path: "$.requiresHostPolicyApproval",
				}),
			]),
		});
	});

	it("builds a host-policy-checkable invocation request from a plan", () => {
		const parsed = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE, {
			sourceUri: "fixture:refarm-git-workflow/SKILL.md",
		});
		const built = buildSkillInvocationPlan(parsed.manifest!);

		const result = buildSkillInvocationRequest(
			built.plan!,
			"Review the current git state and propose a safe workflow.",
		);

		expect(result.ok).toBe(true);
		expect(result.issues).toEqual([]);
		expect(result.request).toMatchObject({
			schema: "refarm.skill-invocation-request.v1",
			skill: {
				id: built.plan?.skill.id,
				name: "refarm-git-workflow",
			},
			input: {
				format: "text/markdown",
				body: "Review the current git state and propose a safe workflow.",
			},
			output: {
				format: "text/markdown",
			},
			requiresHostPolicyApproval: true,
		});
		expect(result.request?.capabilityRequests).toEqual(built.plan?.capabilityRequests);
		expect(result.request?.engineBindings).toEqual(built.plan?.engineBindings);
	});

	it("rejects invocation requests with invalid input or missing host policy approval", () => {
		const parsed = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE);
		const built = buildSkillInvocationPlan(parsed.manifest!);
		const request = buildSkillInvocationRequest(built.plan!, "Review state.");
		expect(request.request).not.toBeNull();

		const result = validateSkillInvocationRequest({
			...request.request,
			input: { format: "application/json", body: "" },
			requiresHostPolicyApproval: false,
		});

		expect(result).toMatchObject({
			ok: false,
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "VALUE_INVALID", path: "$.input.format" }),
				expect.objectContaining({ code: "STRING_EMPTY", path: "$.input.body" }),
				expect.objectContaining({ code: "INVOCATION_POLICY_APPROVAL_REQUIRED" }),
			]),
		});
	});

	it("prepares a manifest and invocation plan from one SKILL.md source", () => {
		const result = prepareSkillInvocationPlan(VALID_SKILL_MARKDOWN_FIXTURE, {
			sourceUri: "fixture:refarm-git-workflow/SKILL.md",
		});

		expect(result.ok).toBe(true);
		expect(result.issues).toEqual([]);
		expect(result.manifest).not.toBeNull();
		expect(result.plan).not.toBeNull();
		expect(result.plan?.skill.id).toBe(result.manifest?.id);
		expect(result.plan?.skill.source.sha256).toBe(result.manifest?.source.sha256);
		expect(result.plan?.engineBindings).toEqual(result.manifest?.engineBindings);
		expect(result.plan?.io).toEqual(result.manifest?.io);
		expect(result.plan?.requiresHostPolicyApproval).toBe(true);
	});

	it("fails closed while preparing a SKILL.md without capabilities", () => {
		const result = prepareSkillInvocationPlan(MISSING_CAPABILITIES_SKILL_MARKDOWN_FIXTURE);

		expect(result.ok).toBe(false);
		expect(result.manifest).toBeNull();
		expect(result.plan).toBeNull();
		expect(result.issues).toContainEqual({
			code: "CAPABILITY_LIST_EMPTY",
			path: "$.capabilities.requires",
			message: "Expected at least one required capability.",
		});
	});

	it("passes the conformance suite with the reference adapter", async () => {
		const result = await runSkillContractV1Conformance(createSkillContractV1Adapter());

		expect(result.pass).toBe(true);
		expect(result.failed).toBe(0);
		expect(result.failures).toEqual([]);
		expect(result.total).toBe(8);
	});
});
