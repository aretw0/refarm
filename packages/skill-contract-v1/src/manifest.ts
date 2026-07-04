import type { SkillContractV1Adapter } from "./types.js";

import { parseSkillMarkdown, validateSkillManifest } from "./manifest-parse.js";

import {
	buildSkillSourceIntegrityEvidence,
	verifySkillSource,
} from "./skill-source-integrity.js";

import {
	buildSkillInvocationDecision,
	buildSkillInvocationPlan,
	buildSkillInvocationRequest,
	prepareSkillInvocationPlan,
} from "./skill-invocation.js";

import {
	buildSkillSurfaceDeclaration,
	evaluateSkillActivationPreflight,
} from "./skill-activation.js";

export function createSkillContractV1Adapter(): SkillContractV1Adapter {
	return {
		buildInvocationDecision: buildSkillInvocationDecision,
		buildInvocationRequest: buildSkillInvocationRequest,
		buildInvocationPlan: buildSkillInvocationPlan,
		buildSourceIntegrityEvidence: buildSkillSourceIntegrityEvidence,
		buildSurfaceDeclaration: buildSkillSurfaceDeclaration,
		evaluateActivationPreflight: evaluateSkillActivationPreflight,
		parseMarkdown: parseSkillMarkdown,
		prepareInvocationPlan: prepareSkillInvocationPlan,
		validateManifest: validateSkillManifest,
		verifySource: verifySkillSource,
	};
}
