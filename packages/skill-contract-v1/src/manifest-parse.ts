import {
	SKILL_MANIFEST_SCHEMA,
	type SkillManifestIssue,
	type SkillManifestParseOptions,
	type SkillManifestParseResult,
	type SkillManifestV1,
	type SkillManifestValidationResult,
} from "./types.js";

import {
	createSkillEngineBindingEnvelope,
	createSkillIoEnvelope,
	createSkillManifestId,
	createSkillSourceRef,
	getString,
	isRecord,
	issue,
	normalizeCapabilityList,
	parseFrontmatter,
	requireExact,
	requireNonEmptyString,
	validateCapabilities,
	validateEngineBindings,
	validateIo,
	validatePolicy,
	validateSource,
} from "./manifest-shared.js";

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
