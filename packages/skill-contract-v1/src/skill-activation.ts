import {
	SKILL_ACTIVATION_PREFLIGHT_SCHEMA,
	type SkillActivationPreflightBuildResult,
	type SkillActivationPreflightOptions,
	type SkillManifestIssue,
	type SkillManifestV1,
	type SkillManifestValidationResult,
	type SkillSurfaceDeclarationBuildResult,
	type SkillSurfaceDeclarationOptions,
	type SkillSurfaceDeclarationV1,
} from "./types.js";

import {
	isRecord,
	issue,
	requireExact,
	slugify,
	validateCapabilityArray,
	validateEngineBindingArray,
	validateSurfaceAssetPath,
	validateSurfaceAssets,
	validateSurfaceId,
} from "./manifest-shared.js";

import { validateSkillManifest } from "./manifest-parse.js";

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
			issues: [
				issue("SURFACE_OPTIONS_NOT_OBJECT", "$", "Expected skill surface declaration options."),
			],
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
		...(options.includeOptionalCapabilities ? (manifest.capabilities.optional ?? []) : []),
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
		issues.push(
			...surfaceValidation.issues.map((item) => ({
				...item,
				path: `$.surface${item.path === "$" ? "" : item.path.slice(1)}`,
			})),
		);
	}

	if (!isRecord(options)) {
		return {
			ok: false,
			preflight: null,
			issues: [
				issue("ACTIVATION_OPTIONS_NOT_OBJECT", "$", "Expected activation preflight options."),
			],
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
		issues.push(
			issue(
				"ACTIVATION_SURFACE_SKILL_MISMATCH",
				"$.surface.id",
				"Expected surface id to match the skill manifest name slug.",
			),
		);
	}

	const surfaceCapabilities = new Set(surface.capabilities);
	for (const capability of manifest.capabilities.requires) {
		if (!surfaceCapabilities.has(capability)) {
			issues.push(
				issue(
					"ACTIVATION_SURFACE_CAPABILITY_MISSING",
					"$.surface.capabilities",
					"Expected package skill surface to declare every required capability.",
				),
			);
			break;
		}
	}

	const approvedCapabilities = new Set(options.approvedCapabilities);
	for (const capability of manifest.capabilities.requires) {
		if (!approvedCapabilities.has(capability)) {
			issues.push(
				issue(
					"ACTIVATION_REQUIRED_CAPABILITY_NOT_APPROVED",
					"$.approvedCapabilities",
					"Expected host policy to approve every required capability before runtime dispatch.",
				),
			);
			break;
		}
	}

	const availableEngineBindings = new Set(options.availableEngineBindings);
	for (const binding of manifest.engineBindings.requires) {
		if (!availableEngineBindings.has(binding)) {
			issues.push(
				issue(
					"ACTIVATION_REQUIRED_ENGINE_UNAVAILABLE",
					"$.availableEngineBindings",
					"Expected every required engine binding to be available before runtime dispatch.",
				),
			);
			break;
		}
	}

	if (install.pluginManifestValid !== true) {
		issues.push(
			issue(
				"ACTIVATION_PLUGIN_MANIFEST_NOT_VALID",
				"$.install.pluginManifestValid",
				"Expected plugin-manifest validation evidence before activation.",
			),
		);
	}
	if (install.integrityVerified !== true) {
		issues.push(
			issue(
				"ACTIVATION_INTEGRITY_NOT_VERIFIED",
				"$.install.integrityVerified",
				"Expected integrity verification evidence before activation.",
			),
		);
	}
	if (install.policyAccepted !== true) {
		issues.push(
			issue(
				"ACTIVATION_POLICY_NOT_ACCEPTED",
				"$.install.policyAccepted",
				"Expected host install policy acceptance before activation.",
			),
		);
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
	// Capabilities are validated for FORM only, and only when present: a surface
	// may declare them (each id must then be valid) or omit them entirely. A
	// surface with zero — or no — capabilities is a valid *permissive* declaration,
	// the same rule parseSkillMarkdown already follows. Requiring them here is a
	// POLICY concern (completeness/maturity) that belongs to a plural evaluator
	// layer (health/quality/design-tells/text-tells) which raises a warning + a
	// resolvable pending-action, NOT to this form check that gates whether a skill
	// can exist at all.
	if (value.capabilities !== undefined) {
		validateCapabilityArray(value.capabilities, "$.capabilities", issues);
	}
	return { ok: issues.length === 0, issues };
}

export function validateActivationInstallEvidence(
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

export function isActivationInstallEvidence(value: unknown): value is {
	pluginManifestValid: boolean;
	integrityVerified: boolean;
	policyAccepted: boolean;
} {
	return (
		isRecord(value) &&
		typeof value.pluginManifestValid === "boolean" &&
		typeof value.integrityVerified === "boolean" &&
		typeof value.policyAccepted === "boolean"
	);
}
