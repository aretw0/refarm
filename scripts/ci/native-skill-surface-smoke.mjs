#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
	createMockManifest,
	validatePluginManifest,
} from "@refarm.dev/plugin-manifest";

import {
	buildSkillInvocationRequest,
	buildSkillSurfaceDeclaration,
	prepareSkillInvocationPlan,
	verifySkillSource,
} from "../../packages/skill-contract-v1/dist/index.js";

const DEFAULT_SOURCE_URI = "fixture:refarm-git-workflow/SKILL.md";
const DEFAULT_ASSET_PATH = "skills/refarm-git-workflow/SKILL.md";
const SCHEMA_VERSION = 1;

export const REFARM_GIT_WORKFLOW_SKILL = `---
name: refarm-git-workflow
description: >
  Refarm operator git workflow wrapper.
requiredCapabilities:
  - refarm.operator-loop
  - refarm.git.write
optionalCapabilities:
  - refarm.github.pr
engineBindings:
  - runtime-agent
  - source:v1
input: Markdown task context for the host to inspect before planning git workflow steps.
inputRequired: true
output: Markdown plan describing the proposed git workflow steps.
---

# Refarm Git Workflow

Start every slice with \`refarm resume --json\` and \`refarm check --next-action --json\`.
Keep source sovereignty: never edit generated artifacts.
After source edits, run \`refarm agent finish --lane after-edit --run --json\`.
After an atomic commit, run \`refarm agent finish --lane after-commit --run --json\`.
Require explicit confirmation before destructive or wide-impact git operations.
`;

function issue(code, message, evidence = null) {
	return {
		code,
		message,
		...(evidence ? { evidence } : {}),
	};
}

function buildPluginManifest(surface) {
	return createMockManifest({
		id: "@refarm.dev/refarm-git-workflow-skill",
		name: "Refarm Git Workflow Skill",
		entry: "./dist/plugin.mjs",
		integrity: undefined,
		capabilities: {
			provides: ["skill:refarm-git-workflow"],
			requires: ["refarm.operator-loop", "refarm.git.write"],
			providesApi: [],
			requiresApi: [],
		},
		extensions: {
			surfaces: [surface],
		},
	});
}

export function buildNativeSkillSurfaceSmoke({
	skillMarkdown = REFARM_GIT_WORKFLOW_SKILL,
	sourceUri = DEFAULT_SOURCE_URI,
	assetPath = DEFAULT_ASSET_PATH,
	input = "Review the current git state and propose a safe Refarm workflow.",
} = {}) {
	const issues = [];
	const prepared = prepareSkillInvocationPlan(skillMarkdown, { sourceUri });
	if (!prepared.ok || !prepared.manifest || !prepared.plan) {
		issues.push(issue(
			"SKILL_PLAN_NOT_READY",
			"Expected SKILL.md to prepare a policy-checkable invocation plan.",
			prepared.issues,
		));
	}

	const sourceCheck = prepared.plan
		? verifySkillSource(skillMarkdown, prepared.plan.skill.source, { sourceUri })
		: null;
	if (sourceCheck && !sourceCheck.ok) {
		issues.push(issue(
			"SKILL_SOURCE_INTEGRITY_FAILED",
			"Expected loaded SKILL.md source to match the planned source reference.",
			sourceCheck.issues,
		));
	}

	const surfaceResult = prepared.manifest
		? buildSkillSurfaceDeclaration(prepared.manifest, { assetPath })
		: null;
	if (surfaceResult && (!surfaceResult.ok || !surfaceResult.surface)) {
		issues.push(issue(
			"SKILL_SURFACE_NOT_READY",
			"Expected manifest to build a plugin-manifest skill surface declaration.",
			surfaceResult.issues,
		));
	}

	const pluginManifest = surfaceResult?.surface ? buildPluginManifest(surfaceResult.surface) : null;
	const pluginManifestValidation = pluginManifest
		? validatePluginManifest(pluginManifest)
		: { valid: false, errors: ["No plugin manifest was built."] };
	if (!pluginManifestValidation.valid) {
		issues.push(issue(
			"PLUGIN_MANIFEST_SKILL_SURFACE_INVALID",
			"Expected plugin-manifest to accept the package skill surface declaration.",
			pluginManifestValidation.errors,
		));
	}

	const requestResult = prepared.plan
		? buildSkillInvocationRequest(prepared.plan, input)
		: null;
	if (requestResult && (!requestResult.ok || !requestResult.request)) {
		issues.push(issue(
			"SKILL_INVOCATION_REQUEST_NOT_READY",
			"Expected invocation plan to build a host-policy-checkable request.",
			requestResult.issues,
		));
	}

	return {
		schemaVersion: SCHEMA_VERSION,
		command: "native-skill-surface-smoke",
		ok: issues.length === 0,
		mode: "plan-only-adapter-smoke",
		executesRuntime: false,
		installsSkill: false,
		selectedSkill: {
			id: prepared.manifest?.id ?? null,
			name: prepared.manifest?.name ?? null,
			sourceUri,
			assetPath,
		},
		pluginManifest: pluginManifest
			? {
				id: pluginManifest.id,
				valid: pluginManifestValidation.valid,
				errors: pluginManifestValidation.errors,
			}
			: null,
		plan: prepared.plan
			? {
				schema: prepared.plan.schema,
				policy: prepared.plan.policy,
				capabilityRequests: prepared.plan.capabilityRequests,
				engineBindings: prepared.plan.engineBindings,
				requiresHostPolicyApproval: prepared.plan.requiresHostPolicyApproval,
			}
			: null,
		surface: surfaceResult?.surface ?? null,
		request: requestResult?.request
			? {
				schema: requestResult.request.schema,
				input: requestResult.request.input,
				output: requestResult.request.output,
				requiresHostPolicyApproval: requestResult.request.requiresHostPolicyApproval,
			}
			: null,
		boundaries: [
			"This smoke does not execute runtime-agent, pi-agent, shell, git, or file tools.",
			"The skill remains a package-declared surface, not a standalone skill installation.",
			"Host policy approval is still required before any future dispatch.",
			"Engine dogfood remains pending until a host records real engine calls.",
		],
		nextActions: issues.length === 0
			? [
				"Select the first host-owned invocation boundary for runtime-agent or a Refarm plugin.",
				"Record the policy approval and engine-call evidence before claiming executable skill support.",
			]
			: [
				"Fix the contract, surface, or request issues before any runtime invocation planning.",
			],
		issueCount: issues.length,
		issues,
	};
}

function parseArgs(argv = []) {
	const args = argv.filter((arg) => arg !== "--");
	const json = args.includes("--json");
	const unknown = args.filter((arg) => arg !== "--json");
	return { json, unknown };
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	const { json, unknown } = parseArgs(process.argv.slice(2));
	if (unknown.length > 0) {
		console.error(`Unknown argument: ${unknown[0]}`);
		process.exit(1);
	}
	const result = buildNativeSkillSurfaceSmoke();
	if (json) {
		console.log(JSON.stringify(result, null, 2));
	} else if (result.ok) {
		console.log("native-skill-surface-smoke: ok");
	} else {
		console.log(`native-skill-surface-smoke: blocked (${result.issueCount} issue(s))`);
		for (const item of result.issues) {
			console.log(`- ${item.code}: ${item.message}`);
		}
	}
	if (!result.ok) process.exit(1);
}
