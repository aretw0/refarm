import {
	SKILL_INVOCATION_DECISION_SCHEMA,
	SKILL_INVOCATION_PLAN_SCHEMA,
	SKILL_INVOCATION_RECEIPT_SCHEMA,
	SKILL_INVOCATION_REQUEST_SCHEMA,
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
	type SkillManifestIssue,
	type SkillManifestParseOptions,
	type SkillManifestV1,
	type SkillManifestValidationResult,
} from "./types.js";

import {
	engineBindingsEqual,
	isCapabilityId,
	isEngineBindingId,
	isRecord,
	issue,
	requireExact,
	requireNonEmptyString,
	validateEngineBindings,
	validateIo,
	validateIsoTimestamp,
	validateOutputEnvelope,
	validatePolicy,
	validateSource,
} from "./manifest-shared.js";

import {
	parseSkillMarkdown,
	validateSkillManifest,
} from "./manifest-parse.js";

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

export function validateInvocationSkillRef(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("INVOCATION_SKILL_NOT_OBJECT", path, "Expected skill reference object."));
		return;
	}
	requireNonEmptyString(value.id, `${path}.id`, issues);
	requireNonEmptyString(value.name, `${path}.name`, issues);
	validateSource(value.source, `${path}.source`, issues);
}

export function validateInvocationCapabilities(
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

export function validateInvocationInput(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("INVOCATION_INPUT_NOT_OBJECT", path, "Expected invocation input object."));
		return;
	}
	requireExact(value.format, "text/markdown", `${path}.format`, issues);
	requireNonEmptyString(value.body, `${path}.body`, issues);
}

export function validateInvocationOutputPayload(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (!isRecord(value)) {
		issues.push(issue("INVOCATION_OUTPUT_NOT_OBJECT", path, "Expected invocation output object."));
		return;
	}
	requireExact(value.format, "text/markdown", `${path}.format`, issues);
	requireNonEmptyString(value.body, `${path}.body`, issues);
}

export function validatePolicyDecision(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (value !== "approved" && value !== "denied") {
		issues.push(issue("INVOCATION_DECISION_VALUE_INVALID", path, "Expected approved or denied."));
	}
}

export function validateExecutionStatus(value: unknown, path: string, issues: SkillManifestIssue[]): void {
	if (value !== "succeeded" && value !== "failed") {
		issues.push(issue("INVOCATION_EXECUTION_STATUS_INVALID", path, "Expected succeeded or failed."));
	}
}

export function validateEngineCallEvidenceList(value: unknown, path: string, issues: SkillManifestIssue[]): void {
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

export function validateEngineCallEvidence(value: unknown, path: string, issues: SkillManifestIssue[]): void {
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

export function validateApprovedCapabilities(
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

export function validateInvocationCapabilityDecisions(
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
