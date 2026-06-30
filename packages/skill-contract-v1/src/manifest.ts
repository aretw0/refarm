import { createHash } from "node:crypto";

import {
	SKILL_INVOCATION_PLAN_SCHEMA,
	SKILL_INVOCATION_REQUEST_SCHEMA,
	SKILL_MANIFEST_SCHEMA,
	type SkillContractV1Adapter,
	type SkillEngineBindingEnvelope,
	type SkillInvocationPlanBuildResult,
	type SkillInvocationPlanPrepareResult,
	type SkillInvocationPlanV1,
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
	type SkillSurfaceDeclarationV1
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
		buildInvocationRequest: buildSkillInvocationRequest,
		buildInvocationPlan: buildSkillInvocationPlan,
		buildSurfaceDeclaration: buildSkillSurfaceDeclaration,
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function issue(code: string, path: string, message: string): SkillManifestIssue {
	return { code, path, message };
}
