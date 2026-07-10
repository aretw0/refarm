import {
	SKILL_SOURCE_INTEGRITY_SCHEMA,
	type SkillActivationInstallEvidence,
	type SkillActivationInstallEvidenceOptions,
	type SkillManifestIssue,
	type SkillManifestParseOptions,
	type SkillManifestV1,
	type SkillSourceIntegrityBuildResult,
	type SkillSourceRef,
	type SkillSourceVerificationResult,
	type SkillSurfaceDeclarationV1,
} from "./types.js";

import { createSkillSourceRef, isRecord, issue, validateSource } from "./manifest-shared.js";

import { validateSkillManifest } from "./manifest-parse.js";

import { validateSkillSurfaceDeclaration } from "./skill-activation.js";

export function verifySkillSource(
	source: string,
	expected: SkillSourceRef,
	options: SkillManifestParseOptions = {},
): SkillSourceVerificationResult {
	const expectedUri =
		isRecord(expected) && typeof expected.uri === "string" ? expected.uri : "inline:skill";
	const actual = createSkillSourceRef(source, {
		sourceUri: options.sourceUri ?? expectedUri,
	});
	const issues: SkillManifestIssue[] = [];
	validateSource(expected, "$.expected", issues);
	if (expected.sha256 !== actual.sha256) {
		issues.push(
			issue(
				"SOURCE_SHA256_MISMATCH",
				"$.expected.sha256",
				"Expected source content SHA-256 to match.",
			),
		);
	}
	if (expected.bytes !== actual.bytes) {
		issues.push(
			issue("SOURCE_BYTES_MISMATCH", "$.expected.bytes", "Expected source byte length to match."),
		);
	}
	if (options.sourceUri !== undefined && expected.uri !== options.sourceUri) {
		issues.push(issue("SOURCE_URI_MISMATCH", "$.expected.uri", "Expected source URI to match."));
	}
	return { ok: issues.length === 0, actual, issues };
}

export function buildSkillSourceIntegrityEvidence(
	source: string,
	manifest: SkillManifestV1,
	surface: SkillSurfaceDeclarationV1,
	options: SkillManifestParseOptions = {},
): SkillSourceIntegrityBuildResult {
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

	const sourceCheck = verifySkillSource(source, manifest.source, options);
	if (!sourceCheck.ok) {
		issues.push(...sourceCheck.issues);
	}

	const assetPath = surface.assets[0] ?? "";
	if (!assetPath) {
		issues.push(
			issue(
				"SOURCE_INTEGRITY_ASSET_MISSING",
				"$.surface.assets",
				"Expected package skill surface to declare the SKILL.md asset path.",
			),
		);
	}

	const verified = issues.length === 0;
	return {
		ok: verified,
		evidence: {
			schema: SKILL_SOURCE_INTEGRITY_SCHEMA,
			source: sourceCheck.actual,
			assetPath,
			verified,
			issues,
		},
		issues,
	};
}

export function buildSkillActivationInstallEvidence(
	options: SkillActivationInstallEvidenceOptions,
): SkillActivationInstallEvidence {
	return {
		pluginManifestValid: options.pluginManifestValid === true,
		integrityVerified: options.sourceIntegrity.verified === true,
		policyAccepted: options.policyDecision.accepted === true,
		policyDecision: options.policyDecision,
	};
}
