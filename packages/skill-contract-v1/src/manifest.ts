import { createHash } from "node:crypto";

import {
	SKILL_INVOCATION_PLAN_SCHEMA,
	SKILL_MANIFEST_SCHEMA,
	type SkillContractV1Adapter,
	type SkillInvocationPlanBuildResult,
	type SkillInvocationPlanPrepareResult,
	type SkillInvocationPlanV1,
	type SkillManifestIssue,
	type SkillManifestParseOptions,
	type SkillManifestParseResult,
	type SkillManifestV1,
	type SkillManifestValidationResult,
	type SkillPolicyEnvelope
} from "./types.js";

const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.:/-][a-z0-9]+)*$/;

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
	const instructions = frontmatterResult.body.trim();
	const hash = sha256(source);

	const manifest: SkillManifestV1 = {
		schema: SKILL_MANIFEST_SCHEMA,
		id: createSkillManifestId(name || "unnamed", hash),
		name,
		...(description ? { description } : {}),
		source: {
			format: "SKILL.md",
			uri: options.sourceUri ?? "inline:skill",
			sha256: hash,
			bytes: Buffer.byteLength(source),
		},
		capabilities: {
			requires: requiredCapabilities,
			...(optionalCapabilities.length > 0 ? { optional: optionalCapabilities } : {}),
			...(providedCapabilities.length > 0 ? { provides: providedCapabilities } : {}),
		},
		policy: {
			executionMode: "plan-only",
			toolAccess: "declared-capabilities-only",
		},
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
	validatePolicy(value.policy, "$.policy", issues);
	requireNonEmptyString(value.instructions, "$.instructions", issues);

	return { ok: issues.length === 0, issues };
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
	requireNonEmptyString(value.instructions, "$.instructions", issues);
	if (value.requiresHostPolicyApproval !== true) {
		issues.push(issue("INVOCATION_POLICY_APPROVAL_REQUIRED", "$.requiresHostPolicyApproval", "Expected true."));
	}
	return { ok: issues.length === 0, issues };
}

export function createSkillContractV1Adapter(): SkillContractV1Adapter {
	return {
		buildInvocationPlan: buildSkillInvocationPlan,
		parseMarkdown: parseSkillMarkdown,
		prepareInvocationPlan: prepareSkillInvocationPlan,
		validateManifest: validateSkillManifest,
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

function isCapabilityId(value: unknown): value is string {
	return typeof value === "string" && CAPABILITY_ID_PATTERN.test(value);
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
