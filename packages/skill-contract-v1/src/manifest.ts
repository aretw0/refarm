import { createHash } from "node:crypto";

import {
	SKILL_ACTIVATION_PREFLIGHT_SCHEMA,
	SKILL_INVOCATION_DECISION_SCHEMA,
	SKILL_INVOCATION_PLAN_SCHEMA,
	SKILL_INVOCATION_RECEIPT_SCHEMA,
	SKILL_INVOCATION_REQUEST_SCHEMA,
	SKILL_MANIFEST_SCHEMA,
	type SkillActivationPreflightBuildResult,
	type SkillActivationPreflightOptions,
	type SkillContractV1Adapter,
	type SkillEngineBindingEnvelope,
	type SkillInvocationDecisionBuildResult,
	type SkillInvocationDecisionOptions,
	type SkillInvocationDecisionV1,
	type SkillInvocationPlanBuildResult,
	type SkillInvocationPlanPrepareResult,
	type SkillInvocationPlanV1,
	type SkillInvocationReceiptBuildResult,
	type SkillInvocationReceiptOptions,
	type SkillInvocationReceiptV1,
	type SkillInvocationRequestBuildResult,
	type SkillInvocationRequestV1,
	type SkillIoEnvelope,
	type SkillManifestIssue,
	type SkillManifestParseOptions,
	type SkillManifestParseResult,
	type SkillManifestV1,
	type SkillManifestValidationResult,
	type SkillPolicyEnvelope,
	type SkillSourceRef,
	type SkillSourceVerificationResult,
	type SkillSurfaceDeclarationBuildResult,
	type SkillSurfaceDeclarationOptions,
	type SkillSurfaceDeclarationV1,
} from "./types.js";

const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.:/-][a-z0-9]+)*$/;
const ENGINE_BINDING_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.:/-][a-z0-9]+)*$/;

export function parseSkillMarkdown(
	source: string,
	options: SkillManifestParseOptions = {},
): SkillManifestParseResult {
	const frontmatterResult = parseFrontmatter(source);
	const issues = [...frontmatterResult.issues];

	if (!frontmatterResult.frontmatter) {
		return { ok: false, manifest: null, issues };
	}

	const name = getString(frontmatterResult.frontmatter.name);
	const description = getString(frontmatterResult.frontmatter.description);
	const requiredCapabilities = normalizeCapabilityList(
		frontmatterResult.frontmatter.requiredCapabilities ??
			frontmatterResult.frontmatter.requiresCapabilities,
	);
	const optionalCapabilities = normalizeCapabilityList(
		frontmatterResult.frontmatter.optionalCapabilities,
	);
	const providedCapabilities = normalizeCapabilityList(
		frontmatterResult.frontmatter.providesCapabilities,
	);
	const engineBindings = createSkillEngineBindingEnvelope(frontmatterResult.frontmatter);
	const io = createSkillIoEnvelope(frontmatterResult.frontmatter);
	const instructions = frontmatterResult.body.trim();
	const sourceRef = createSkillSourceRef(source, options);

	const manifest: SkillManifestV1 = {
		schema: SKILL_MANIFEST_SCHEMA,
		id: createSkillManifestId(name || "unnamed", sourceRef.sha256),
		name,
		...(description ? { description } : {}),
		source: sourceRef,
		capabilities: {
			requires: requiredCapabilities,
			...(optionalCapabilities.length > 0 ? { optional: optionalCapabilities } : {}),
			...(providedCapabilities.length > 0 ? { provides: providedCapabilities } : {}),
		},
		engineBindings,
		policy: {
			executionMode: "plan-only",
			toolAccess: "declared-capabilities-only",
		},
		io,
		instructions,
		frontmatter: frontmatterResult.frontmatter,
	};

	const validation = validateSkillManifest(manifest);
	return {
		ok: validation.ok,
		manifest: validation.ok ? manifest : null,
		issues: [...issues, ...validation.issues],
	};
}

export function validateSkillManifest(value: unknown): SkillManifestValidationResult {
	const issues: SkillManifestIssue[] = [];

	if (!isRecord(value)) {
		return {
			ok: false,
			issues: [issue("MANIFEST_NOT_OBJECT", "$", "Expected a skill manifest object.")],
		};
	}

	requireExact(value.schema, SKILL_MANIFEST_SCHEMA, "$.schema", issues);
	requireNonEmptyString(value.id, "$.id", issues);
	requireNonEmptyString(value.name, "$.name", issues);
	validateSource(value.source, "$.source", issues);
	validateCapabilities(value.capabilities, "$.capabilities", issues);
	validateEngineBindings(value.engineBindings, "$.engineBindings", issues);
	validatePolicy(value.policy, "$.policy", issues);
	validateIo(value.io, "$.io", issues);
	requireNonEmptyString(value.instructions, "$.instructions", issues);

	return { ok: issues.length === 0, issues };
}

export function createSkillSourceRef(
	source: string,
	options: SkillManifestParseOptions = {},
): SkillSourceRef {
	return {
		format: "SKILL.md",
		uri: options.sourceUri ?? "inline:skill",
		sha256: sha256(source),
		bytes: Buffer.byteLength(source),
	};
}

export function verifySkillSource(
	source: string,
	expected: SkillSourceRef,
	options: SkillManifestParseOptions = {},
): SkillSourceVerificationResult {
	const expectedUri = isRecord(expected) && typeof expected.uri === "string"
		? expected.uri
		: "inline:skill";
	const actual = createSkillSourceRef(source, {
		sourceUri: options.sourceUri ?? expectedUri,
	});
	const issues: SkillManifestIssue[] = [];
	validateSource(expected, "$.expected", issues);
	if (expected.sha256 !== actual.sha256) {
		issues.push(issue("SOURCE_SHA256_MISMATCH", "$.expected.sha256", "Expected source content SHA-256 to match."));
	}
	if (expected.bytes !== actual.bytes) {
		issues.push(issue("SOURCE_BYTES_MISMATCH", "$.expected.bytes", "Expected source byte length to match."));
	}
	if (options.sourceUri !== undefined && expected.uri !== options.sourceUri) {
		issues.push(issue("SOURCE_URI_MISMATCH", "$.expected.uri", "Expected source URI to match."));
	}
	return { ok: issues.length === 0, actual, issues };
}

export function buildSkillInvocationPlan(
	manifest: SkillManifestV1,
): SkillInvocationPlanBuildResult {
	const validation = validateSkillManifest(manifest);
	if (!validation.ok) {
		return { ok: false, plan: null, issues: validation.issues };
	}

	const plan: SkillInvocationPlanV1 = {
		schema: SKILL_INVOCATION_PLAN_SCHEMA,
		skill: {
			id: manifest.id,
			name: manifest.name,
			source: manifest.source,
		},
		policy: manifest.policy,
		capabilityRequests: [
			...manifest.capabilities.requires.map((id) => ({ id, required: true })),
			...(manifest.capabilities.optional ?? []).map((id) => ({ id, required: false })),
		],
		engineBindings: manifest.engineBindings,
		io: manifest.io,
		instructions: manifest.instructions,
		requiresHostPolicyApproval: true,
	};
	const planValidation = validateSkillInvocationPlan(plan);
	return {
		ok: planValidation.ok,
		plan: planValidation.ok ? plan : null,
		issues: planValidation.issues,
	};
}

export function buildSkillInvocationRequest(
	plan: SkillInvocationPlanV1,
	input: string,
): SkillInvocationRequestBuildResult {
	const planValidation = validateSkillInvocationPlan(plan);
	if (!planValidation.ok) {
		return { ok: false, request: null, issues: planValidation.issues };
	}

	const request: SkillInvocationRequestV1 = {
		schema: SKILL_INVOCATION_REQUEST_SCHEMA,
		skill: plan.skill,
		input: {
			format: plan.io.input.format,
			body: input,
		},
		policy: plan.policy,
		capabilityRequests: plan.capabilityRequests,
		engineBindings: plan.engineBindings,
		output: plan.io.output,
		requiresHostPolicyApproval: true,
	};
	const validation = validateSkillInvocationRequest(request);
	return {
		ok: validation.ok,
		request: validation.ok ? request : null,
		issues: validation.issues,
	};
}

export function buildSkillInvocationDecision(
	request: SkillInvocationRequestV1,
	options: SkillInvocationDecisionOptions,
): SkillInvocationDecisionBuildResult {
	const requestValidation = validateSkillInvocationRequest(request);
	if (!requestValidation.ok) {
		return { ok: false, decision: null, issues: requestValidation.issues };
	}
	if (!isRecord(options)) {
		return {
			ok: false,
			decision: null,
			issues: [issue("INVOCATION_DECISION_OPTIONS_NOT_OBJECT", "$", "Expected invocation decision options.")],
		};
	}

	const issues: SkillManifestIssue[] = [];
	validatePolicyDecision(options.decision, "$.decision", issues);
	requireNonEmptyString(options.reason, "$.reason", issues);
	if (options.approvedCapabilities !== undefined) {
		validateApprovedCapabilities(options.approvedCapabilities, "$.approvedCapabilities", request, issues);
	}
	if (options.decision === "approved" && !Array.isArray(options.approvedCapabilities)) {
		issues.push(issue(
			"INVOCATION_DECISION_APPROVED_CAPABILITIES_REQUIRED",
			"$.approvedCapabilities",
			"Expected explicit approved capabilities for an approval decision.",
		));
	}
	if (issues.length > 0) {
		return { ok: false, decision: null, issues };
	}

	const approvedCapabilities = new Set(options.approvedCapabilities ?? []);
	const capabilityDecisions = request.capabilityRequests.map((item) => ({
		id: item.id,
		required: item.required,
		decision: approvedCapabilities.has(item.id) ? "approved" as const : "denied" as const,
		...(!approvedCapabilities.has(item.id) ? { reason: "Capability was not approved by host policy." } : {}),
	}));
	const decision: SkillInvocationDecisionV1 = {
		schema: SKILL_INVOCATION_DECISION_SCHEMA,
		request,
		decision: options.decision,
		reason: options.reason,
		capabilityDecisions,
		engineBindings: request.engineBindings,
		requiresRuntimeDispatch: options.decision === "approved",
		executed: false,
	};
	const validation = validateSkillInvocationDecision(decision);
	return {
		ok: validation.ok,
		decision: validation.ok ? decision : null,
		issues: validation.issues,
	};
}

export function buildSkillInvocationReceipt(
	decision: SkillInvocationDecisionV1,
	options: SkillInvocationReceiptOptions,
): SkillInvocationReceiptBuildResult {
	const decisionValidation = validateSkillInvocationDecision(decision);
	if (!decisionValidation.ok) {
		return { ok: false, receipt: null, issues: decisionValidation.issues };
	}
	if (!isRecord(options)) {
		return {
			ok: false,
			receipt: null,
			issues: [issue("INVOCATION_RECEIPT_OPTIONS_NOT_OBJECT", "$", "Expected invocation receipt options.")],
		};
	}

	const issues: SkillManifestIssue[] = [];
	validateExecutionStatus(options.status, "$.status", issues);
	validateEngineCallEvidenceList(options.engineCalls, "$.engineCalls", issues);
	if (options.output !== undefined) {
		validateInvocationOutputPayload(options.output, "$.output", issues);
	}
	if (options.error !== undefined) {
		requireNonEmptyString(options.error, "$.error", issues);
	}
	if (options.completedAt !== undefined) {
		validateIsoTimestamp(options.completedAt, "$.completedAt", issues);
	}
	if (options.status === "succeeded" && options.output === undefined) {
		issues.push(issue("INVOCATION_RECEIPT_OUTPUT_REQUIRED", "$.output", "Expected output for succeeded receipts."));
	}
	if (options.status === "failed" && options.error === undefined) {
		issues.push(issue("INVOCATION_RECEIPT_ERROR_REQUIRED", "$.error", "Expected error for failed receipts."));
	}
	if (issues.length > 0) {
		return { ok: false, receipt: null, issues };
	}

	const receipt: SkillInvocationReceiptV1 = {
		schema: SKILL_INVOCATION_RECEIPT_SCHEMA,
		decision,
		status: options.status,
		engineCalls: options.engineCalls,
		...(options.output ? { output: options.output } : {}),
		...(options.error ? { error: options.error } : {}),
		completedAt: options.completedAt ?? new Date().toISOString(),
		executed: true,
	};
	const validation = validateSkillInvocationReceipt(receipt);
	return {
		ok: validation.ok,
		receipt: validation.ok ? receipt : null,
		issues: validation.issues,
	};
}

export function buildSkillSurfaceDeclaration(
	manifest: SkillManifestV1,
	options: SkillSurfaceDeclarationOptions,
): SkillSurfaceDeclarationBuildResult {
	const manifestValidation = validateSkillManifest(manifest);
	if (!manifestValidation.ok) {
		return { ok: false, surface: null, issues: manifestValidation.issues };
	}
	if (!isRecord(options)) {
		return {
			ok: false,
			surface: null,
			issues: [issue("SURFACE_OPTIONS_NOT_OBJECT", "$", "Expected skill surface declaration options.")],
		};
	}

	const optionsIssues: SkillManifestIssue[] = [];
	validateSurfaceAssetPath(options.assetPath, "$.assetPath", optionsIssues);
	if (options.id !== undefined) {
		validateSurfaceId(options.id, "$.id", optionsIssues);
	}
	if (optionsIssues.length > 0) {
		return { ok: false, surface: null, issues: optionsIssues };
	}

	const capabilities = [
		...manifest.capabilities.requires,
		...(options.includeOptionalCapabilities ? manifest.capabilities.optional ?? [] : []),
	];
	const surface: SkillSurfaceDeclarationV1 = {
		layer: "pi",
		kind: "skill",
		id: options.id ?? slugify(manifest.name),
		assets: [options.assetPath],
		capabilities,
	};
	const validation = validateSkillSurfaceDeclaration(surface);
	return {
		ok: validation.ok,
		surface: validation.ok ? surface : null,
		issues: validation.issues,
	};
}

export function evaluateSkillActivationPreflight(
	manifest: SkillManifestV1,
	surface: SkillSurfaceDeclarationV1,
	options: SkillActivationPreflightOptions,
): SkillActivationPreflightBuildResult {
	const issues: SkillManifestIssue[] = [];

	const manifestValidation = validateSkillManifest(manifest);
	if (!manifestValidation.ok) {
		issues.push(...manifestValidation.issues);
	}

	const surfaceValidation = validateSkillSurfaceDeclaration(surface);
	if (!surfaceValidation.ok) {
		issues.push(...surfaceValidation.issues.map((item) => ({
			...item,
			path: `$.surface${item.path === "$" ? "" : item.path.slice(1)}`,
		})));
	}

	if (!isRecord(options)) {
		return {
			ok: false,
			preflight: null,
			issues: [issue("ACTIVATION_OPTIONS_NOT_OBJECT", "$", "Expected activation preflight options.")],
		};
	}

	validateCapabilityArray(options.approvedCapabilities, "$.approvedCapabilities", issues);
	validateEngineBindingArray(options.availableEngineBindings, "$.availableEngineBindings", issues);
	validateActivationInstallEvidence(options.install, "$.install", issues);
	const install = isActivationInstallEvidence(options.install)
		? options.install
		: {
			pluginManifestValid: false,
			integrityVerified: false,
			policyAccepted: false,
		};

	if (surface.id !== slugify(manifest.name)) {
		issues.push(issue(
			"ACTIVATION_SURFACE_SKILL_MISMATCH",
			"$.surface.id",
			"Expected surface id to match the skill manifest name slug.",
		));
	}

	const surfaceCapabilities = new Set(surface.capabilities);
	for (const capability of manifest.capabilities.requires) {
		if (!surfaceCapabilities.has(capability)) {
			issues.push(issue(
				"ACTIVATION_SURFACE_CAPABILITY_MISSING",
				"$.surface.capabilities",
				"Expected package skill surface to declare every required capability.",
			));
			break;
		}
	}

	const approvedCapabilities = new Set(options.approvedCapabilities);
	for (const capability of manifest.capabilities.requires) {
		if (!approvedCapabilities.has(capability)) {
			issues.push(issue(
				"ACTIVATION_REQUIRED_CAPABILITY_NOT_APPROVED",
				"$.approvedCapabilities",
				"Expected host policy to approve every required capability before runtime dispatch.",
			));
			break;
		}
	}

	const availableEngineBindings = new Set(options.availableEngineBindings);
	for (const binding of manifest.engineBindings.requires) {
		if (!availableEngineBindings.has(binding)) {
			issues.push(issue(
				"ACTIVATION_REQUIRED_ENGINE_UNAVAILABLE",
				"$.availableEngineBindings",
				"Expected every required engine binding to be available before runtime dispatch.",
			));
			break;
		}
	}

	if (install.pluginManifestValid !== true) {
		issues.push(issue(
			"ACTIVATION_PLUGIN_MANIFEST_NOT_VALID",
			"$.install.pluginManifestValid",
			"Expected plugin-manifest validation evidence before activation.",
		));
	}
	if (install.integrityVerified !== true) {
		issues.push(issue(
			"ACTIVATION_INTEGRITY_NOT_VERIFIED",
			"$.install.integrityVerified",
			"Expected integrity verification evidence before activation.",
		));
	}
	if (install.policyAccepted !== true) {
		issues.push(issue(
			"ACTIVATION_POLICY_NOT_ACCEPTED",
			"$.install.policyAccepted",
			"Expected host install policy acceptance before activation.",
		));
	}

	const state = issues.length === 0 ? "ready" : "blocked";
	return {
		ok: issues.length === 0,
		preflight: {
			schema: SKILL_ACTIVATION_PREFLIGHT_SCHEMA,
			skill: {
				id: manifest.id,
				name: manifest.name,
				source: manifest.source,
			},
			surface,
			install,
			approvedCapabilities: options.approvedCapabilities,
			availableEngineBindings: options.availableEngineBindings,
			state,
			readyForRuntimeDispatch: state === "ready",
			issues,
		},
		issues,
	};
}

export function prepareSkillInvocationPlan(
	source: string,
	options: SkillManifestParseOptions = {},
): SkillInvocationPlanPrepareResult {
	const parsed = parseSkillMarkdown(source, options);
	if (!parsed.ok || !parsed.manifest) {
		return { ok: false, manifest: null, plan: null, issues: parsed.issues };
	}

	const built = buildSkillInvocationPlan(parsed.manifest);
	if (!built.ok || !built.plan) {
		return { ok: false, manifest: parsed.manifest, plan: null, issues: built.issues };
	}

	return {
		ok: true,
		manifest: parsed.manifest,
		plan: built.plan,
		issues: [],
	};
}

export function validateSkillInvocationPlan(value: unknown): SkillManifestValidationResult {
	const issues: SkillManifestIssue[] = [];
	if (!isRecord(value)) {
		return {
			ok: false,
			issues: [issue("INVOCATION_PLAN_NOT_OBJECT", "$", "Expected a skill invocation plan object.")],
		};
	}

	requireExact(value.schema, SKILL_INVOCATION_PLAN_SCHEMA, "$.schema", issues);
	validateInvocationSkillRef(value.skill, "$.skill", issues);
	validatePolicy(value.policy, "$.policy", issues);
	validateInvocationCapabilities(value.capabilityRequests, "$.capabilityRequests", issues);
	validateEngineBindings(value.engineBindings, "$.engineBindings", issues);
	validateIo(value.io, "$.io", issues);
	requireNonEmptyString(value.instructions, "$.instructions", issues);
	if (value.requiresHostPolicyApproval !== true) {
		issues.push(issue("INVOCATION_POLICY_APPROVAL_REQUIRED", "$.requiresHostPolicyApproval", "Expected true."));
	}
	return { ok: issues.length === 0, issues };
}

export function validateSkillInvocationRequest(value: unknown): SkillManifestValidationResult {
	const issues: SkillManifestIssue[] = [];
	if (!isRecord(value)) {
		return {
			ok: false,
			issues: [issue("INVOCATION_REQUEST_NOT_OBJECT", "$", "Expected a skill invocation request object.")],
		};
	}

	requireExact(value.schema, SKILL_INVOCATION_REQUEST_SCHEMA, "$.schema", issues);
	validateInvocationSkillRef(value.skill, "$.skill", issues);
	validateInvocationInput(value.input, "$.input", issues);
	validatePolicy(value.policy, "$.policy", issues);
	validateInvocationCapabilities(value.capabilityRequests, "$.capabilityRequests", issues);
	validateEngineBindings(value.engineBindings, "$.engineBindings", issues);
	validateOutputEnvelope(value.output, "$.output", issues);
	if (value.requiresHostPolicyApproval !== true) {
		issues.push(issue("INVOCATION_POLICY_APPROVAL_REQUIRED", "$.requiresHostPolicyApproval", "Expected true."));
	}
	return { ok: issues.length === 0, issues };
}

export function validateSkillInvocationDecision(value: unknown): SkillManifestValidationResult {
	const issues: SkillManifestIssue[] = [];
	if (!isRecord(value)) {
		return {
			ok: false,
			issues: [issue("INVOCATION_DECISION_NOT_OBJECT", "$", "Expected a skill invocation decision object.")],
		};
	}

	requireExact(value.schema, SKILL_INVOCATION_DECISION_SCHEMA, "$.schema", issues);
	const requestValidation = validateSkillInvocationRequest(value.request);
	if (!requestValidation.ok) {
		issues.push(...requestValidation.issues.map((item) => ({
			...item,
			path: `$.request${item.path === "$" ? "" : item.path.slice(1)}`,
		})));
	}
	validatePolicyDecision(value.decision, "$.decision", issues);
	requireNonEmptyString(value.reason, "$.reason", issues);
	validateEngineBindings(value.engineBindings, "$.engineBindings", issues);
	if (isRecord(value.request) && !engineBindingsEqual(value.engineBindings, value.request.engineBindings)) {
		issues.push(issue(
			"INVOCATION_DECISION_ENGINE_BINDINGS_MISMATCH",
			"$.engineBindings",
			"Expected decision engine bindings to match the invocation request.",
		));
	}
	if (value.requiresRuntimeDispatch !== true && value.requiresRuntimeDispatch !== false) {
		issues.push(issue("INVOCATION_RUNTIME_DISPATCH_INVALID", "$.requiresRuntimeDispatch", "Expected boolean."));
	}
	if (value.executed !== false) {
		issues.push(issue("INVOCATION_DECISION_EXECUTED_INVALID", "$.executed", "Expected false."));
	}
	const request = isRecord(value.request) ? value.request : null;
	validateInvocationCapabilityDecisions(
		value.capabilityDecisions,
		"$.capabilityDecisions",
		isRecord(request) && Array.isArray(request.capabilityRequests) ? request.capabilityRequests : [],
		value.decision,
		issues,
	);
	if (value.decision === "approved" && value.requiresRuntimeDispatch !== true) {
		issues.push(issue(
			"INVOCATION_APPROVAL_REQUIRES_RUNTIME_DISPATCH",
			"$.requiresRuntimeDispatch",
			"Expected approved decisions to require runtime dispatch.",
		));
	}
	if (value.decision === "denied" && value.requiresRuntimeDispatch !== false) {
		issues.push(issue(
			"INVOCATION_DENIAL_BLOCKS_RUNTIME_DISPATCH",
			"$.requiresRuntimeDispatch",
			"Expected denied decisions to block runtime dispatch.",
		));
	}
	return { ok: issues.length === 0, issues };
}

export function validateSkillInvocationReceipt(value: unknown): SkillManifestValidationResult {
	const issues: SkillManifestIssue[] = [];
	if (!isRecord(value)) {
		return {
			ok: false,
			issues: [issue("INVOCATION_RECEIPT_NOT_OBJECT", "$", "Expected a skill invocation receipt object.")],
		};
	}

	requireExact(value.schema, SKILL_INVOCATION_RECEIPT_SCHEMA, "$.schema", issues);
	const decisionValidation = validateSkillInvocationDecision(value.decision);
	if (!decisionValidation.ok) {
		issues.push(...decisionValidation.issues.map((item) => ({
			...item,
			path: `$.decision${item.path === "$" ? "" : item.path.slice(1)}`,
		})));
	}
	if (isRecord(value.decision)) {
		if (value.decision.decision !== "approved") {
			issues.push(issue("INVOCATION_RECEIPT_REQUIRES_APPROVAL", "$.decision.decision", "Expected approved decision."));
		}
		if (value.decision.requiresRuntimeDispatch !== true) {
			issues.push(issue(
				"INVOCATION_RECEIPT_REQUIRES_RUNTIME_DISPATCH",
				"$.decision.requiresRuntimeDispatch",
				"Expected decision to require runtime dispatch.",
			));
		}
		if (value.decision.executed !== false) {
			issues.push(issue("INVOCATION_RECEIPT_DECISION_ALREADY_EXECUTED", "$.decision.executed", "Expected false."));
		}
	}
	validateExecutionStatus(value.status, "$.status", issues);
	validateEngineCallEvidenceList(value.engineCalls, "$.engineCalls", issues);
	if (value.output !== undefined) {
		validateInvocationOutputPayload(value.output, "$.output", issues);
	}
	if (value.error !== undefined) {
		requireNonEmptyString(value.error, "$.error", issues);
	}
	validateIsoTimestamp(value.completedAt, "$.completedAt", issues);
	if (value.executed !== true) {
		issues.push(issue("INVOCATION_RECEIPT_EXECUTED_INVALID", "$.executed", "Expected true."));
	}
	if (value.status === "succeeded" && value.output === undefined) {
		issues.push(issue("INVOCATION_RECEIPT_OUTPUT_REQUIRED", "$.output", "Expected output for succeeded receipts."));
	}
	if (value.status === "failed" && value.error === undefined) {
		issues.push(issue("INVOCATION_RECEIPT_ERROR_REQUIRED", "$.error", "Expected error for failed receipts."));
	}
	return { ok: issues.length === 0, issues };
}

export function validateSkillSurfaceDeclaration(value: unknown): SkillManifestValidationResult {
	const issues: SkillManifestIssue[] = [];
	if (!isRecord(value)) {
		return {
			ok: false,
			issues: [issue("SURFACE_NOT_OBJECT", "$", "Expected a skill surface declaration object.")],
		};
	}

	requireExact(value.layer, "pi", "$.layer", issues);
	requireExact(value.kind, "skill", "$.kind", issues);
	validateSurfaceId(value.id, "$.id", issues);
	validateSurfaceAssets(value.assets, "$.assets", issues);
	validateCapabilityArray(value.capabilities, "$.capabilities", issues, { requireNonEmpty: true });
	return { ok: issues.length === 0, issues };
}

export function createSkillContractV1Adapter(): SkillContractV1Adapter {
	return {
		buildInvocationDecision: buildSkillInvocationDecision,
		buildInvocationRequest: buildSkillInvocationRequest,
		buildInvocationPlan: buildSkillInvocationPlan,
		buildSurfaceDeclaration: buildSkillSurfaceDeclaration,
		evaluateActivationPreflight: evaluateSkillActivationPreflight,
		parseMarkdown: parseSkillMarkdown,
		prepareInvocationPlan: prepareSkillInvocationPlan,
		validateManifest: validateSkillManifest,
		verifySource: verifySkillSource,
	};
}

function parseFrontmatter(source: string): {
	frontmatter: Readonly<Record<string, string | readonly string[]>> | null;
	body: string;
	issues: SkillManifestIssue[];
} {
	const issues: SkillManifestIssue[] = [];
	if (!source.startsWith("---\n")) {
		issues.push(issue("FRONTMATTER_MISSING", "$", "Expected SKILL.md frontmatter."));
		return { frontmatter: null, body: source, issues };
	}
	const end = source.indexOf("\n---", 4);
	if (end === -1) {
		issues.push(issue("FRONTMATTER_UNCLOSED", "$", "Expected closing frontmatter marker."));
		return { frontmatter: null, body: source, issues };
	}

	const frontmatterLines = source.slice(4, end).split("\n");
	const bodyStart = source.indexOf("\n", end + 4);
	const body = bodyStart === -1 ? "" : source.slice(bodyStart + 1);
	const frontmatter: Record<string, string | readonly string[]> = {};

	for (let index = 0; index < frontmatterLines.length; index++) {
		const line = frontmatterLines[index] ?? "";
		if (!line.trim()) continue;
		const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
		if (!match) {
			issues.push(issue("FRONTMATTER_LINE_INVALID", `$.frontmatter.${index}`, "Expected key: value."));
			continue;
		}

		const key = match[1]!;
		const value = match[2]!.trim();
		if (value === ">" || value === "|") {
			const block: string[] = [];
			while (frontmatterLines[index + 1]?.startsWith(" ")) {
				index++;
				block.push((frontmatterLines[index] ?? "").trim());
			}
			frontmatter[key] = block.join(value === ">" ? " " : "\n").trim();
			continue;
		}

		if (value === "") {
			const list: string[] = [];
			while (/^\s*-\s+/.test(frontmatterLines[index + 1] ?? "")) {
				index++;
				list.push(stripQuotes((frontmatterLines[index] ?? "").replace(/^\s*-\s+/, "").trim()));
			}
			frontmatter[key] = list.length > 0 ? list : "";
			continue;
		}

		frontmatter[key] = stripQuotes(value);
	}

	return { frontmatter, body, issues };
}

function validateSource(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("SOURCE_NOT_OBJECT", path, "Expected source object."));
		return;
	}
	requireExact(value.format, "SKILL.md", `${path}.format`, issues);
	requireNonEmptyString(value.uri, `${path}.uri`, issues);
	if (!isSha256(value.sha256)) {
		issues.push(issue("SOURCE_SHA256_INVALID", `${path}.sha256`, "Expected lowercase SHA-256 hex."));
	}
	if (!Number.isInteger(value.bytes) || (value.bytes as number) <= 0) {
		issues.push(issue("SOURCE_BYTES_INVALID", `${path}.bytes`, "Expected a positive byte count."));
	}
}

function validateCapabilities(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("CAPABILITIES_NOT_OBJECT", path, "Expected capabilities object."));
		return;
	}
	validateCapabilityArray(value.requires, `${path}.requires`, issues, { requireNonEmpty: true });
	if (value.optional !== undefined) {
		validateCapabilityArray(value.optional, `${path}.optional`, issues);
	}
	if (value.provides !== undefined) {
		validateCapabilityArray(value.provides, `${path}.provides`, issues);
	}
}

function validateEngineBindings(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("ENGINE_BINDINGS_NOT_OBJECT", path, "Expected engine binding object."));
		return;
	}
	validateEngineBindingArray(value.requires, `${path}.requires`, issues);
	if (value.optional !== undefined) {
		validateEngineBindingArray(value.optional, `${path}.optional`, issues);
	}
}

function validatePolicy(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("POLICY_NOT_OBJECT", path, "Expected policy object."));
		return;
	}
	const policy = value as Partial<SkillPolicyEnvelope>;
	if (policy.executionMode !== "plan-only" && policy.executionMode !== "host-invoked") {
		issues.push(issue("POLICY_EXECUTION_MODE_INVALID", `${path}.executionMode`, "Expected a known execution mode."));
	}
	if (policy.toolAccess !== "declared-capabilities-only") {
		issues.push(issue("POLICY_TOOL_ACCESS_INVALID", `${path}.toolAccess`, "Expected declared-capabilities-only."));
	}
}

function validateIo(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("IO_NOT_OBJECT", path, "Expected input/output envelope object."));
		return;
	}
	validateInputEnvelope(value.input, `${path}.input`, issues);
	validateOutputEnvelope(value.output, `${path}.output`, issues);
}

function validateInputEnvelope(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("INPUT_NOT_OBJECT", path, "Expected input envelope object."));
		return;
	}
	requireExact(value.format, "text/markdown", `${path}.format`, issues);
	if (typeof value.required !== "boolean") {
		issues.push(issue("INPUT_REQUIRED_INVALID", `${path}.required`, "Expected boolean."));
	}
	if (value.description !== undefined) {
		requireNonEmptyString(value.description, `${path}.description`, issues);
	}
}

function validateOutputEnvelope(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("OUTPUT_NOT_OBJECT", path, "Expected output envelope object."));
		return;
	}
	requireExact(value.format, "text/markdown", `${path}.format`, issues);
	if (value.description !== undefined) {
		requireNonEmptyString(value.description, `${path}.description`, issues);
	}
}

function createSkillIoEnvelope(
	frontmatter: Readonly<Record<string, string | readonly string[]>>,
): SkillIoEnvelope {
	const inputDescription = getString(frontmatter.input);
	const outputDescription = getString(frontmatter.output);
	return {
		input: {
			format: "text/markdown",
			required: getBoolean(frontmatter.inputRequired, false),
			...(inputDescription ? { description: inputDescription } : {}),
		},
		output: {
			format: "text/markdown",
			...(outputDescription ? { description: outputDescription } : {}),
		},
	};
}

function createSkillEngineBindingEnvelope(
	frontmatter: Readonly<Record<string, string | readonly string[]>>,
): SkillEngineBindingEnvelope {
	const required = normalizeEngineBindingList(
		frontmatter.engineBindings ??
			frontmatter.requiredEngineBindings ??
			frontmatter.requiresEngines,
	);
	const optional = normalizeEngineBindingList(
		frontmatter.optionalEngineBindings ??
			frontmatter.optionalEngines,
	);
	return {
		requires: required,
		...(optional.length > 0 ? { optional } : {}),
	};
}

function validateInvocationSkillRef(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("INVOCATION_SKILL_NOT_OBJECT", path, "Expected skill reference object."));
		return;
	}
	requireNonEmptyString(value.id, `${path}.id`, issues);
	requireNonEmptyString(value.name, `${path}.name`, issues);
	validateSource(value.source, `${path}.source`, issues);
}

function validateInvocationCapabilities(
	value: unknown,
	path: string,
	issues: SkillManifestIssue[],
): void {
	if (!Array.isArray(value)) {
		issues.push(issue("INVOCATION_CAPABILITY_LIST_INVALID", path, "Expected capability request array."));
		return;
	}
	if (value.length === 0) {
		issues.push(issue("INVOCATION_CAPABILITY_LIST_EMPTY", path, "Expected at least one capability request."));
	}
	value.forEach((item, index) => {
		const itemPath = `${path}.${index}`;
		if (!isRecord(item)) {
			issues.push(issue("INVOCATION_CAPABILITY_NOT_OBJECT", itemPath, "Expected capability request object."));
			return;
		}
		if (!isCapabilityId(item.id)) {
			issues.push(issue("CAPABILITY_ID_INVALID", `${itemPath}.id`, "Expected a valid capability id."));
		}
		if (typeof item.required !== "boolean") {
			issues.push(issue("INVOCATION_CAPABILITY_REQUIRED_INVALID", `${itemPath}.required`, "Expected boolean."));
		}
	});
}

function validateInvocationInput(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("INVOCATION_INPUT_NOT_OBJECT", path, "Expected invocation input object."));
		return;
	}
	requireExact(value.format, "text/markdown", `${path}.format`, issues);
	requireNonEmptyString(value.body, `${path}.body`, issues);
}

function validateInvocationOutputPayload(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("INVOCATION_OUTPUT_NOT_OBJECT", path, "Expected invocation output object."));
		return;
	}
	requireExact(value.format, "text/markdown", `${path}.format`, issues);
	requireNonEmptyString(value.body, `${path}.body`, issues);
}

function validatePolicyDecision(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (value !== "approved" && value !== "denied") {
		issues.push(issue("INVOCATION_DECISION_VALUE_INVALID", path, "Expected approved or denied."));
	}
}

function validateExecutionStatus(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (value !== "succeeded" && value !== "failed") {
		issues.push(issue("INVOCATION_EXECUTION_STATUS_INVALID", path, "Expected succeeded or failed."));
	}
}

function validateEngineCallEvidenceList(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue("ENGINE_CALL_EVIDENCE_LIST_INVALID", path, "Expected engine call evidence array."));
		return;
	}
	if (value.length === 0) {
		issues.push(issue("ENGINE_CALL_EVIDENCE_LIST_EMPTY", path, "Expected at least one engine call evidence entry."));
	}
	value.forEach((item, index) => {
		validateEngineCallEvidence(item, `${path}.${index}`, issues);
	});
}

function validateEngineCallEvidence(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("ENGINE_CALL_EVIDENCE_NOT_OBJECT", path, "Expected engine call evidence object."));
		return;
	}
	if (!isEngineBindingId(value.engineBinding)) {
		issues.push(issue("ENGINE_BINDING_ID_INVALID", `${path}.engineBinding`, "Expected a valid engine binding id."));
	}
	if (!isCapabilityId(value.capability)) {
		issues.push(issue("CAPABILITY_ID_INVALID", `${path}.capability`, "Expected a valid capability id."));
	}
	requireNonEmptyString(value.providerId, `${path}.providerId`, issues);
	requireNonEmptyString(value.operation, `${path}.operation`, issues);
	if (typeof value.ok !== "boolean") {
		issues.push(issue("ENGINE_CALL_OK_INVALID", `${path}.ok`, "Expected boolean."));
	}
	if (typeof value.durationMs !== "number" || value.durationMs < 0 || !Number.isFinite(value.durationMs)) {
		issues.push(issue("ENGINE_CALL_DURATION_INVALID", `${path}.durationMs`, "Expected a non-negative duration."));
	}
	if (value.error !== undefined) {
		requireNonEmptyString(value.error, `${path}.error`, issues);
	}
}

function validateApprovedCapabilities(
	value: unknown,
	path: string,
	request: SkillInvocationRequestV1,
	issues: SkillManifestIssue[],
): void {
	if (!Array.isArray(value)) {
		issues.push(issue("APPROVED_CAPABILITY_LIST_INVALID", path, "Expected an array of capability ids."));
		return;
	}

	const requested = new Set(request.capabilityRequests.map((item) => item.id));
	const seen = new Set<string>();
	value.forEach((item, index) => {
		const itemPath = `${path}.${index}`;
		if (!isCapabilityId(item)) {
			issues.push(issue("CAPABILITY_ID_INVALID", itemPath, "Expected a valid capability id."));
			return;
		}
		if (!requested.has(item)) {
			issues.push(issue("APPROVED_CAPABILITY_NOT_REQUESTED", itemPath, "Expected a requested capability id."));
		}
		if (seen.has(item)) {
			issues.push(issue("APPROVED_CAPABILITY_DUPLICATE", itemPath, "Expected capability approvals to be unique."));
		}
		seen.add(item);
	});
}

function validateInvocationCapabilityDecisions(
	value: unknown,
	path: string,
	requestedCapabilities: readonly unknown[],
	decision: unknown,
	issues: SkillManifestIssue[],
): void {
	if (!Array.isArray(value)) {
		issues.push(issue("INVOCATION_CAPABILITY_DECISIONS_INVALID", path, "Expected capability decision array."));
		return;
	}
	if (value.length === 0) {
		issues.push(issue("INVOCATION_CAPABILITY_DECISIONS_EMPTY", path, "Expected at least one capability decision."));
	}

	const requestedById = new Map<string, boolean>();
	requestedCapabilities.forEach((item) => {
		if (isRecord(item) && typeof item.id === "string" && typeof item.required === "boolean") {
			requestedById.set(item.id, item.required);
		}
	});
	const seen = new Set<string>();
	value.forEach((item, index) => {
		const itemPath = `${path}.${index}`;
		if (!isRecord(item)) {
			issues.push(issue("INVOCATION_CAPABILITY_DECISION_NOT_OBJECT", itemPath, "Expected capability decision object."));
			return;
		}
		if (!isCapabilityId(item.id)) {
			issues.push(issue("CAPABILITY_ID_INVALID", `${itemPath}.id`, "Expected a valid capability id."));
			return;
		}
		if (!requestedById.has(item.id)) {
			issues.push(issue("INVOCATION_CAPABILITY_DECISION_NOT_REQUESTED", `${itemPath}.id`, "Expected requested capability id."));
		}
		if (seen.has(item.id)) {
			issues.push(issue("INVOCATION_CAPABILITY_DECISION_DUPLICATE", `${itemPath}.id`, "Expected one decision per capability."));
		}
		seen.add(item.id);
		if (typeof item.required !== "boolean") {
			issues.push(issue("INVOCATION_CAPABILITY_DECISION_REQUIRED_INVALID", `${itemPath}.required`, "Expected boolean."));
		} else if (requestedById.get(item.id) !== item.required) {
			issues.push(issue(
				"INVOCATION_CAPABILITY_DECISION_REQUIRED_MISMATCH",
				`${itemPath}.required`,
				"Expected required flag to match the invocation request.",
			));
		}
		validatePolicyDecision(item.decision, `${itemPath}.decision`, issues);
		if (item.reason !== undefined) {
			requireNonEmptyString(item.reason, `${itemPath}.reason`, issues);
		}
		if (decision === "approved" && item.required === true && item.decision !== "approved") {
			issues.push(issue(
				"INVOCATION_REQUIRED_CAPABILITY_NOT_APPROVED",
				`${itemPath}.decision`,
				"Expected approved decisions to approve every required capability.",
			));
		}
		if (decision === "denied" && item.decision === "approved") {
			issues.push(issue(
				"INVOCATION_DENIAL_APPROVES_CAPABILITY",
				`${itemPath}.decision`,
				"Expected denied decisions to approve no capabilities.",
			));
		}
	});
	for (const id of requestedById.keys()) {
		if (!seen.has(id)) {
			issues.push(issue("INVOCATION_CAPABILITY_DECISION_MISSING", path, "Expected one decision per requested capability."));
		}
	}
}

function validateSurfaceAssets(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!Array.isArray(value)) {
		issues.push(issue("SURFACE_ASSETS_INVALID", path, "Expected an array of relative asset paths."));
		return;
	}
	if (value.length === 0) {
		issues.push(issue("SURFACE_ASSETS_EMPTY", path, "Expected at least one skill asset path."));
	}
	value.forEach((item, index) => {
		validateSurfaceAssetPath(item, `${path}.${index}`, issues);
	});
}

function validateSurfaceAssetPath(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	requireNonEmptyString(value, path, issues);
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	if (trimmed.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
		issues.push(issue("SURFACE_ASSET_PATH_INVALID", path, "Expected a relative package asset path."));
	}
}

function validateSurfaceId(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	requireNonEmptyString(value, path, issues);
	if (typeof value !== "string") return;
	if (slugify(value) !== value) {
		issues.push(issue("SURFACE_ID_INVALID", path, "Expected a lowercase slug id."));
	}
}

function validateCapabilityArray(
	value: unknown,
	path: string,
	issues: SkillManifestIssue[],
	options: { requireNonEmpty?: boolean } = {},
): void {
	if (!Array.isArray(value)) {
		issues.push(issue("CAPABILITY_LIST_INVALID", path, "Expected an array of capability ids."));
		return;
	}
	if (options.requireNonEmpty && value.length === 0) {
		issues.push(issue("CAPABILITY_LIST_EMPTY", path, "Expected at least one required capability."));
	}
	value.forEach((item, index) => {
		if (!isCapabilityId(item)) {
			issues.push(issue("CAPABILITY_ID_INVALID", `${path}.${index}`, "Expected a valid capability id."));
		}
	});
}

function validateEngineBindingArray(
	value: unknown,
	path: string,
	issues: SkillManifestIssue[],
): void {
	if (!Array.isArray(value)) {
		issues.push(issue("ENGINE_BINDING_LIST_INVALID", path, "Expected an array of engine binding ids."));
		return;
	}
	value.forEach((item, index) => {
		if (!isEngineBindingId(item)) {
			issues.push(issue("ENGINE_BINDING_ID_INVALID", `${path}.${index}`, "Expected a valid engine binding id."));
		}
	});
}

function validateActivationInstallEvidence(
	value: unknown,
	path: string,
	issues: SkillManifestIssue[],
): void {
	if (!isRecord(value)) {
		issues.push(issue("ACTIVATION_INSTALL_NOT_OBJECT", path, "Expected install evidence object."));
		return;
	}
	for (const key of ["pluginManifestValid", "integrityVerified", "policyAccepted"]) {
		if (typeof value[key] !== "boolean") {
			issues.push(issue("ACTIVATION_INSTALL_FLAG_INVALID", `${path}.${key}`, "Expected boolean."));
		}
	}
}

function isActivationInstallEvidence(value: unknown): value is {
	pluginManifestValid: boolean;
	integrityVerified: boolean;
	policyAccepted: boolean;
} {
	return isRecord(value) &&
		typeof value.pluginManifestValid === "boolean" &&
		typeof value.integrityVerified === "boolean" &&
		typeof value.policyAccepted === "boolean";
}

function normalizeCapabilityList(value: unknown): readonly string[] {
	if (Array.isArray(value)) {
		return value.map(String).map((item) => item.trim()).filter(Boolean);
	}
	if (typeof value !== "string") return [];
	const trimmed = value.trim();
	if (!trimmed) return [];
	const withoutBrackets =
		trimmed.startsWith("[") && trimmed.endsWith("]")
			? trimmed.slice(1, -1)
			: trimmed;
	return withoutBrackets
		.split(",")
		.map((item) => stripQuotes(item.trim()))
		.filter(Boolean);
}

function normalizeEngineBindingList(value: unknown): readonly string[] {
	if (Array.isArray(value)) {
		return value.map(String).map((item) => item.trim()).filter(Boolean);
	}
	if (typeof value !== "string") return [];
	const trimmed = value.trim();
	if (!trimmed) return [];
	const withoutBrackets =
		trimmed.startsWith("[") && trimmed.endsWith("]")
			? trimmed.slice(1, -1)
			: trimmed;
	return withoutBrackets
		.split(",")
		.map((item) => stripQuotes(item.trim()))
		.filter(Boolean);
}

function createSkillManifestId(name: string, hash: string): string {
	return `urn:refarm:skill:v1:${slugify(name)}:${hash.slice(0, 12)}`;
}

function slugify(value: string): string {
	const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
	return slug || "unnamed";
}

function stripQuotes(value: string): string {
	if (
		(value.startsWith("\"") && value.endsWith("\"")) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function requireExact(
	value: unknown,
	expected: string,
	path: string,
	issues: SkillManifestIssue[],
): void {
	if (value !== expected) {
		issues.push(issue("VALUE_INVALID", path, `Expected ${expected}.`));
	}
}

function requireNonEmptyString(
	value: unknown,
	path: string,
	issues: SkillManifestIssue[],
): void {
	if (typeof value !== "string" || value.length === 0) {
		issues.push(issue("STRING_EMPTY", path, "Expected a non-empty string."));
	}
}

function getString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function getBoolean(value: unknown, fallback: boolean): boolean {
	if (typeof value !== "string") return fallback;
	const normalized = value.trim().toLowerCase();
	if (normalized === "true" || normalized === "yes") return true;
	if (normalized === "false" || normalized === "no") return false;
	return fallback;
}

function isCapabilityId(value: unknown): value is string {
	return typeof value === "string" && CAPABILITY_ID_PATTERN.test(value);
}

function isEngineBindingId(value: unknown): value is string {
	return typeof value === "string" && ENGINE_BINDING_ID_PATTERN.test(value);
}

function isSha256(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validateIsoTimestamp(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	requireNonEmptyString(value, path, issues);
	if (typeof value !== "string") return;
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
		issues.push(issue("TIMESTAMP_INVALID", path, "Expected an ISO-8601 timestamp."));
	}
}

function engineBindingsEqual(left: unknown, right: unknown): boolean {
	if (!isRecord(left) || !isRecord(right)) return false;
	return stringArraysEqual(left.requires, right.requires) && stringArraysEqual(left.optional, right.optional);
}

function stringArraysEqual(left: unknown, right: unknown): boolean {
	if (left === undefined && right === undefined) return true;
	if (!Array.isArray(left) || !Array.isArray(right)) return false;
	if (left.length !== right.length) return false;
	return left.every((item, index) => item === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function issue(code: string, path: string, message: string): SkillManifestIssue {
	return { code, path, message };
}
