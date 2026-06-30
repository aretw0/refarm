import { describe, expect, it } from "vitest";

import {
	MISSING_CAPABILITIES_SKILL_MARKDOWN_FIXTURE,
	VALID_SKILL_MARKDOWN_FIXTURE,
	runSkillContractV1Conformance,
} from "./conformance.js";
import {
	buildSkillInvocationDecision,
	buildSkillInvocationPlan,
	buildSkillInvocationReceipt,
	buildSkillInvocationRequest,
	buildSkillSourceIntegrityEvidence,
	buildSkillSurfaceDeclaration,
	createSkillContractV1Adapter,
	createSkillSourceRef,
	evaluateSkillActivationPreflight,
	parseSkillMarkdown,
	prepareSkillInvocationPlan,
	validateSkillInvocationDecision,
	validateSkillInvocationPlan,
	validateSkillInvocationReceipt,
	validateSkillInvocationRequest,
	validateSkillManifest,
	validateSkillSurfaceDeclaration,
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

	it("builds package skill source integrity evidence for activation preflight", () => {
		const parsed = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE, {
			sourceUri: "fixture:refarm-git-workflow/SKILL.md",
		});
		const surface = buildSkillSurfaceDeclaration(parsed.manifest!, {
			assetPath: "skills/refarm-git-workflow/SKILL.md",
		});

		const result = buildSkillSourceIntegrityEvidence(
			VALID_SKILL_MARKDOWN_FIXTURE,
			parsed.manifest!,
			surface.surface!,
			{ sourceUri: "fixture:refarm-git-workflow/SKILL.md" },
		);

		expect(result.ok).toBe(true);
		expect(result.issues).toEqual([]);
		expect(result.evidence).toEqual({
			schema: "refarm.skill-source-integrity.v1",
			source: parsed.manifest?.source,
			assetPath: "skills/refarm-git-workflow/SKILL.md",
			verified: true,
			issues: [],
		});
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

	it("blocks source integrity evidence when the package skill source drifts", () => {
		const parsed = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE, {
			sourceUri: "fixture:refarm-git-workflow/SKILL.md",
		});
		const surface = buildSkillSurfaceDeclaration(parsed.manifest!, {
			assetPath: "skills/refarm-git-workflow/SKILL.md",
		});

		const result = buildSkillSourceIntegrityEvidence(
			`${VALID_SKILL_MARKDOWN_FIXTURE}\nChanged`,
			parsed.manifest!,
			surface.surface!,
			{ sourceUri: "fixture:other/SKILL.md" },
		);

		expect(result.ok).toBe(false);
		expect(result.evidence).toMatchObject({
			schema: "refarm.skill-source-integrity.v1",
			assetPath: "skills/refarm-git-workflow/SKILL.md",
			verified: false,
		});
		expect(result.issues).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: "SOURCE_SHA256_MISMATCH" }),
			expect.objectContaining({ code: "SOURCE_BYTES_MISMATCH" }),
			expect.objectContaining({ code: "SOURCE_URI_MISMATCH" }),
		]));
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

	it("builds a host policy decision before runtime dispatch", () => {
		const parsed = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE, {
			sourceUri: "fixture:refarm-git-workflow/SKILL.md",
		});
		const built = buildSkillInvocationPlan(parsed.manifest!);
		const request = buildSkillInvocationRequest(
			built.plan!,
			"Review the current git state and propose a safe workflow.",
		);

		const result = buildSkillInvocationDecision(request.request!, {
			decision: "approved",
			reason: "Operator approved the declared workflow capabilities.",
			approvedCapabilities: ["refarm.operator-loop", "refarm.git.write"],
		});

		expect(result.ok).toBe(true);
		expect(result.issues).toEqual([]);
		expect(result.decision).toMatchObject({
			schema: "refarm.skill-invocation-decision.v1",
			request: request.request,
			decision: "approved",
			reason: "Operator approved the declared workflow capabilities.",
			requiresRuntimeDispatch: true,
			executed: false,
		});
		expect(result.decision?.capabilityDecisions).toEqual([
			{ id: "refarm.operator-loop", required: true, decision: "approved" },
			{ id: "refarm.git.write", required: true, decision: "approved" },
			{
				id: "refarm.github.pr",
				required: false,
				decision: "denied",
				reason: "Capability was not approved by host policy.",
			},
		]);
		expect(result.decision?.engineBindings).toEqual(request.request?.engineBindings);
	});

	it("rejects approval decisions that skip required capability approval", () => {
		const parsed = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE);
		const built = buildSkillInvocationPlan(parsed.manifest!);
		const request = buildSkillInvocationRequest(built.plan!, "Review state.");

		const result = buildSkillInvocationDecision(request.request!, {
			decision: "approved",
			reason: "Incomplete approval should fail.",
			approvedCapabilities: ["refarm.operator-loop"],
		});

		expect(result).toMatchObject({
			ok: false,
			decision: null,
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "INVOCATION_REQUIRED_CAPABILITY_NOT_APPROVED" }),
			]),
		});
	});

	it("rejects invocation decisions that execute early or let denials authorize capabilities", () => {
		const parsed = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE);
		const built = buildSkillInvocationPlan(parsed.manifest!);
		const request = buildSkillInvocationRequest(built.plan!, "Review state.");
		const denied = buildSkillInvocationDecision(request.request!, {
			decision: "denied",
			reason: "Host policy denied this request.",
		});
		expect(denied.decision).not.toBeNull();

		const result = validateSkillInvocationDecision({
			...denied.decision,
			requiresRuntimeDispatch: true,
			executed: true,
			capabilityDecisions: [
				{ id: "refarm.operator-loop", required: true, decision: "approved" },
				{ id: "refarm.git.write", required: true, decision: "denied" },
				{ id: "refarm.github.pr", required: false, decision: "denied" },
			],
		});

		expect(result).toMatchObject({
			ok: false,
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "INVOCATION_DENIAL_BLOCKS_RUNTIME_DISPATCH" }),
				expect.objectContaining({ code: "INVOCATION_DECISION_EXECUTED_INVALID" }),
				expect.objectContaining({ code: "INVOCATION_DENIAL_APPROVES_CAPABILITY" }),
			]),
		});
	});

	it("builds an execution receipt from an approved decision and engine evidence", () => {
		const parsed = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE);
		const built = buildSkillInvocationPlan(parsed.manifest!);
		const request = buildSkillInvocationRequest(built.plan!, "Review state.");
		const decision = buildSkillInvocationDecision(request.request!, {
			decision: "approved",
			reason: "Operator approved this workflow.",
			approvedCapabilities: ["refarm.operator-loop", "refarm.git.write"],
		});

		const result = buildSkillInvocationReceipt(decision.decision!, {
			status: "succeeded",
			completedAt: "2026-06-30T00:00:00.000Z",
			engineCalls: [
				{
					engineBinding: "source:v1",
					capability: "refarm.operator-loop",
					providerId: "@refarm.dev/source-local",
					operation: "status",
					ok: true,
					durationMs: 4,
				},
			],
			output: {
				format: "text/markdown",
				body: "Source status inspected.",
			},
		});

		expect(result.ok).toBe(true);
		expect(result.issues).toEqual([]);
		expect(result.receipt).toMatchObject({
			schema: "refarm.skill-invocation-receipt.v1",
			status: "succeeded",
			completedAt: "2026-06-30T00:00:00.000Z",
			executed: true,
			output: {
				format: "text/markdown",
				body: "Source status inspected.",
			},
		});
		expect(result.receipt?.decision).toEqual(decision.decision);
	});

	it("rejects execution receipts without approval, evidence, or required outcome fields", () => {
		const parsed = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE);
		const built = buildSkillInvocationPlan(parsed.manifest!);
		const request = buildSkillInvocationRequest(built.plan!, "Review state.");
		const denied = buildSkillInvocationDecision(request.request!, {
			decision: "denied",
			reason: "Host policy denied this request.",
		});
		expect(denied.decision).not.toBeNull();

		const result = validateSkillInvocationReceipt({
			schema: "refarm.skill-invocation-receipt.v1",
			decision: denied.decision,
			status: "succeeded",
			engineCalls: [],
			completedAt: "not-a-date",
			executed: false,
		});

		expect(result).toMatchObject({
			ok: false,
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "INVOCATION_RECEIPT_REQUIRES_APPROVAL" }),
				expect.objectContaining({ code: "ENGINE_CALL_EVIDENCE_LIST_EMPTY" }),
				expect.objectContaining({ code: "TIMESTAMP_INVALID" }),
				expect.objectContaining({ code: "INVOCATION_RECEIPT_EXECUTED_INVALID" }),
				expect.objectContaining({ code: "INVOCATION_RECEIPT_OUTPUT_REQUIRED" }),
			]),
		});
	});

	it("builds a plugin-manifest-compatible skill surface declaration", () => {
		const parsed = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE, {
			sourceUri: "file:skills/refarm-git-workflow/SKILL.md",
		});

		const result = buildSkillSurfaceDeclaration(parsed.manifest!, {
			assetPath: "skills/refarm-git-workflow/SKILL.md",
		});

		expect(result.ok).toBe(true);
		expect(result.issues).toEqual([]);
		expect(result.surface).toEqual({
			layer: "pi",
			kind: "skill",
			id: "refarm-git-workflow",
			assets: ["skills/refarm-git-workflow/SKILL.md"],
			capabilities: ["refarm.operator-loop", "refarm.git.write"],
		});
	});

	it("rejects skill surface declarations that are not package asset declarations", () => {
		const parsed = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE);
		const built = buildSkillSurfaceDeclaration(parsed.manifest!, {
			assetPath: "file:skills/refarm-git-workflow/SKILL.md",
			id: "Bad Id",
		});
		const missingOptions = buildSkillSurfaceDeclaration(parsed.manifest!, undefined as never);

		expect(built).toMatchObject({
			ok: false,
			surface: null,
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "SURFACE_ASSET_PATH_INVALID", path: "$.assetPath" }),
				expect.objectContaining({ code: "SURFACE_ID_INVALID", path: "$.id" }),
			]),
		});
		expect(missingOptions).toMatchObject({
			ok: false,
			surface: null,
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "SURFACE_OPTIONS_NOT_OBJECT", path: "$" }),
			]),
		});

		expect(validateSkillSurfaceDeclaration({
			layer: "pi",
			kind: "skill",
			id: "refarm-git-workflow",
			assets: ["/tmp/SKILL.md"],
			capabilities: [],
		})).toMatchObject({
			ok: false,
			issues: expect.arrayContaining([
				expect.objectContaining({ code: "SURFACE_ASSET_PATH_INVALID", path: "$.assets.0" }),
				expect.objectContaining({ code: "CAPABILITY_LIST_EMPTY", path: "$.capabilities" }),
			]),
		});
	});

	it("evaluates activation preflight before a package skill surface can dispatch", () => {
		const parsed = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE);
		const surface = buildSkillSurfaceDeclaration(parsed.manifest!, {
			assetPath: "skills/refarm-git-workflow/SKILL.md",
		});

		const result = evaluateSkillActivationPreflight(parsed.manifest!, surface.surface!, {
			approvedCapabilities: ["refarm.operator-loop", "refarm.git.write"],
			availableEngineBindings: ["runtime-agent", "source:v1"],
			install: {
				pluginManifestValid: true,
				integrityVerified: true,
				policyAccepted: true,
			},
		});

		expect(result.ok).toBe(true);
		expect(result.issues).toEqual([]);
		expect(result.preflight).toMatchObject({
			schema: "refarm.skill-activation-preflight.v1",
			state: "ready",
			readyForRuntimeDispatch: true,
			surface: surface.surface,
			install: {
				pluginManifestValid: true,
				integrityVerified: true,
				policyAccepted: true,
			},
		});
	});

	it("blocks activation preflight when host install or runtime evidence is missing", () => {
		const parsed = parseSkillMarkdown(VALID_SKILL_MARKDOWN_FIXTURE);
		const surface = buildSkillSurfaceDeclaration(parsed.manifest!, {
			assetPath: "skills/refarm-git-workflow/SKILL.md",
		});

		const result = evaluateSkillActivationPreflight(parsed.manifest!, surface.surface!, {
			approvedCapabilities: ["refarm.operator-loop"],
			availableEngineBindings: ["source:v1"],
			install: {
				pluginManifestValid: true,
				integrityVerified: false,
				policyAccepted: false,
			},
		});

		expect(result.ok).toBe(false);
		expect(result.preflight).toMatchObject({
			schema: "refarm.skill-activation-preflight.v1",
			state: "blocked",
			readyForRuntimeDispatch: false,
		});
		expect(result.issues).toEqual(expect.arrayContaining([
			expect.objectContaining({ code: "ACTIVATION_REQUIRED_CAPABILITY_NOT_APPROVED" }),
			expect.objectContaining({ code: "ACTIVATION_REQUIRED_ENGINE_UNAVAILABLE" }),
			expect.objectContaining({ code: "ACTIVATION_INTEGRITY_NOT_VERIFIED" }),
			expect.objectContaining({ code: "ACTIVATION_POLICY_NOT_ACCEPTED" }),
		]));
		expect(result.preflight?.issues).toEqual(result.issues);
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
		expect(result.total).toBe(12);
	});
});
