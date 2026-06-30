#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createLocalSourceProvider } from "../../packages/source-local/dist/index.js";
import {
	buildSkillInvocationDecision,
	buildSkillInvocationReceipt,
	buildSkillInvocationRequest,
	prepareSkillInvocationPlan,
	verifySkillSource,
} from "../../packages/skill-contract-v1/dist/index.js";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_SOURCE_DIR =
	process.env.VAULT_SEED_SOURCE_DIR ??
	"/home/vscode/.cache/checkouts/github.com/aretw0/vault-seed";
const DEFAULT_SKILL_NAME = "vault-search";
const DEFAULT_SOURCE_URI = "fixture:vault-seed/dgk-vault-search-refarm-wrapper/SKILL.md";
const SCHEMA_VERSION = 1;

const READONLY_MARKERS = [
	"dgk lab note search",
	"query=",
	"tags=",
	"folder=",
];

const MUTATION_MARKERS = [
	"dgk lab note create",
	"dgk lab note write",
	"dgk lab note update",
	"dgk lab note delete",
	"rm -rf",
	"git reset --hard",
	"mv ",
	"cp ",
];

export function buildDgkVaultSearchWrapperSkill({ upstreamPath, upstreamSha256 }) {
	return `---
name: dgk-vault-search-refarm-wrapper
description: >
  Refarm read-only wrapper for vault-seed dgk vault-search source evidence.
requiredCapabilities:
  - refarm.operator-loop
  - source:v1
engineBindings:
  - source:v1
input: Markdown task context describing the external vault-seed checkout to inspect before vault search guidance.
inputRequired: true
output: Markdown source and boundary evidence for the wrapped DGK vault-search skill.
---

# DGK Vault Search Refarm Wrapper

Start with \`refarm resume --json\` and \`refarm check --next-action --json\`.
Treat the upstream DGK skill as downstream-owned source evidence.
Do not execute \`dgk\`, Obsidian CLI, shell tools, file mutations, runtime-agent, pi-agent, or model calls in this smoke.
Use \`source:v1\` only to inspect the external checkout state and record evidence.

The upstream vault-seed skill is source evidence, not installed runtime code:

- source path: ${upstreamPath}
- source sha256: ${upstreamSha256}
`;
}

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

function issue(code, message, evidence = null) {
	return {
		code,
		message,
		...(evidence ? { evidence } : {}),
	};
}

function skillPathFor(skillName) {
	return `packages/dgk-skills/skills/${skillName}/SKILL.md`;
}

export function reviewDgkVaultSkillSource({ sourceDir = DEFAULT_SOURCE_DIR, skillName = DEFAULT_SKILL_NAME } = {}) {
	const sourcePath = skillPathFor(skillName);
	const absolutePath = path.join(sourceDir, sourcePath);
	const issues = [];
	if (!existsSync(absolutePath)) {
		return {
			ok: false,
			decision: "missing-source",
			target: {
				id: `dgk-skills/${skillName}`,
				sourceDir,
				sourcePath,
				sha256: null,
				bytes: 0,
			},
			issues: [
				issue(
					"DGK_SKILL_SOURCE_MISSING",
					"Expected the selected DGK skill source to exist in the vault-seed checkout.",
					absolutePath,
				),
			],
		};
	}

	const text = readFileSync(absolutePath, "utf8");
	for (const marker of READONLY_MARKERS) {
		if (!text.includes(marker)) {
			issues.push(issue(
				"DGK_VAULT_SEARCH_READONLY_MARKER_MISSING",
				"Expected vault-search to keep its read-only search command guidance.",
				marker,
			));
		}
	}
	for (const marker of MUTATION_MARKERS) {
		if (text.includes(marker)) {
			issues.push(issue(
				"DGK_VAULT_SEARCH_MUTATION_MARKER_PRESENT",
				"Expected the selected DGK fixture to stay read-only before wrapper smoke.",
				marker,
			));
		}
	}
	if (!/^name:\s+vault-search$/m.test(text)) {
		issues.push(issue(
			"DGK_VAULT_SEARCH_NAME_UNEXPECTED",
			"Expected the selected DGK fixture to be the vault-search skill.",
		));
	}
	if (!text.includes("Obsidian CLI")) {
		issues.push(issue(
			"DGK_VAULT_SEARCH_PRODUCT_BOUNDARY_MISSING",
			"Expected upstream source to keep Obsidian CLI as downstream product behavior.",
		));
	}

	return {
		ok: issues.length === 0,
		decision: issues.length === 0 ? "requires-refarm-wrapper-before-install" : "reject-or-edit-source-before-install",
		target: {
			id: `dgk-skills/${skillName}`,
			sourceDir,
			sourcePath,
			sha256: sha256(text),
			bytes: Buffer.byteLength(text),
		},
		issues,
	};
}

function formatWrappedOutput({ review, status, sourceDir }) {
	return [
		"# DGK vault-search wrapper evidence",
		"",
		`- source checkout: ${sourceDir}`,
		`- source skill: ${review.target.sourcePath}`,
		`- source sha256: ${review.target.sha256}`,
		`- convention decision: ${review.decision}`,
		`- source kind: ${status.kind}`,
		`- source materialized: ${String(status.materialized)}`,
		`- source clean: ${String(status.clean)}`,
		`- source dirty: ${String(status.dirty)}`,
		`- source untracked: ${String(status.untracked)}`,
		`- source head: ${status.head ?? "unknown"}`,
	].join("\n");
}

async function timedEngineCall(fn) {
	const started = performance.now();
	try {
		const value = await fn();
		return {
			ok: true,
			value,
			durationMs: Math.max(0, Math.round((performance.now() - started) * 1000) / 1000),
		};
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
			durationMs: Math.max(0, Math.round((performance.now() - started) * 1000) / 1000),
		};
	}
}

export async function buildNativeSkillDgkVaultSearchSmoke({
	root = DEFAULT_ROOT,
	sourceDir = DEFAULT_SOURCE_DIR,
	skillName = DEFAULT_SKILL_NAME,
	sourceUri = DEFAULT_SOURCE_URI,
	completedAt,
} = {}) {
	const issues = [];
	const review = reviewDgkVaultSkillSource({ sourceDir, skillName });
	if (!review.ok) {
		issues.push(issue(
			"DGK_VAULT_SEARCH_REVIEW_NOT_READY",
			"Expected DGK vault-search review to pass before wrapper smoke.",
			review.issues,
		));
	}
	if (review.decision !== "requires-refarm-wrapper-before-install") {
		issues.push(issue(
			"DGK_VAULT_SEARCH_DECISION_UNEXPECTED",
			"Expected DGK vault-search to require a Refarm wrapper before installation.",
			review.decision,
		));
	}
	if (!review.target.sourcePath || !review.target.sha256) {
		issues.push(issue(
			"DGK_VAULT_SEARCH_SOURCE_MISSING",
			"Expected DGK review to expose source path and SHA-256 evidence.",
			review.target,
		));
	}

	const upstreamPath = review.target.sourcePath ?? "unknown";
	const upstreamSha256 = review.target.sha256 ?? "unknown";
	const wrapperSkill = buildDgkVaultSearchWrapperSkill({ upstreamPath, upstreamSha256 });
	const prepared = prepareSkillInvocationPlan(wrapperSkill, { sourceUri });
	if (!prepared.ok || !prepared.manifest || !prepared.plan) {
		issues.push(issue(
			"WRAPPER_SKILL_PLAN_NOT_READY",
			"Expected DGK vault-search wrapper to prepare a policy-checkable plan.",
			prepared.issues,
		));
	}

	const sourceCheck = prepared.plan
		? verifySkillSource(wrapperSkill, prepared.plan.skill.source, { sourceUri })
		: null;
	if (sourceCheck && !sourceCheck.ok) {
		issues.push(issue(
			"WRAPPER_SKILL_SOURCE_INTEGRITY_FAILED",
			"Expected wrapper source integrity to match the planned source reference.",
			sourceCheck.issues,
		));
	}

	const requestResult = prepared.plan
		? buildSkillInvocationRequest(
			prepared.plan,
			`Inspect vault-seed checkout ${sourceDir} before wrapping DGK vault-search guidance.`,
		)
		: null;
	if (requestResult && (!requestResult.ok || !requestResult.request)) {
		issues.push(issue(
			"WRAPPER_SKILL_INVOCATION_REQUEST_NOT_READY",
			"Expected wrapper plan to build an invocation request.",
			requestResult.issues,
		));
	}

	const decisionResult = requestResult?.request
		? buildSkillInvocationDecision(requestResult.request, {
			decision: "approved",
			reason: "Smoke host approved the wrapper operator-loop and source:v1 evidence capabilities.",
			approvedCapabilities: requestResult.request.capabilityRequests
				.filter((item) => item.required)
				.map((item) => item.id),
		})
		: null;
	if (decisionResult && (!decisionResult.ok || !decisionResult.decision)) {
		issues.push(issue(
			"WRAPPER_SKILL_INVOCATION_DECISION_NOT_READY",
			"Expected wrapper request to build a host policy decision.",
			decisionResult.issues,
		));
	}

	const provider = createLocalSourceProvider({
		pluginId: "@refarm.dev/source-local",
		cwd: root,
	});
	const sourceRef = `local:${sourceDir}`;
	const statusCall = decisionResult?.decision
		? await timedEngineCall(() => provider.status(sourceRef))
		: null;
	const engineCall = statusCall
		? {
			engineBinding: "source:v1",
			capability: "source:v1",
			providerId: provider.pluginId,
			operation: "status",
			ok: statusCall.ok,
			durationMs: statusCall.durationMs,
			...(statusCall.ok ? {} : { error: statusCall.error }),
		}
		: null;
	if (statusCall && !statusCall.ok) {
		issues.push(issue(
			"DGK_VAULT_SEED_SOURCE_ENGINE_STATUS_FAILED",
			"Expected source-local status engine call to succeed for vault-seed checkout.",
			statusCall.error,
		));
	}
	if (statusCall?.ok && !statusCall.value.materialized) {
		issues.push(issue(
			"DGK_VAULT_SEED_SOURCE_NOT_MATERIALIZED",
			"Expected vault-seed checkout to be materialized before DGK wrapper smoke.",
			statusCall.value,
		));
	}

	const receiptResult = decisionResult?.decision && engineCall
		? buildSkillInvocationReceipt(decisionResult.decision, {
			status: statusCall?.ok ? "succeeded" : "failed",
			completedAt,
			engineCalls: [engineCall],
			...(statusCall?.ok
				? {
					output: {
						format: "text/markdown",
						body: formatWrappedOutput({ review, status: statusCall.value, sourceDir }),
					},
				}
				: { error: statusCall?.error ?? "source:v1 status failed" }),
		})
		: null;
	if (receiptResult && (!receiptResult.ok || !receiptResult.receipt)) {
		issues.push(issue(
			"WRAPPER_SKILL_INVOCATION_RECEIPT_NOT_READY",
			"Expected wrapper invocation to build an execution receipt.",
			receiptResult.issues,
		));
	}

	return {
		schemaVersion: SCHEMA_VERSION,
		command: "native-skill-dgk-vault-search-smoke",
		ok: issues.length === 0,
		mode: "external-skill-wrapper-dogfood-smoke",
		executesRuntimeAgent: false,
		executesEngine: Boolean(statusCall),
		installsExternalSkill: false,
		executesDgk: false,
		selectedExternalSkill: {
			id: review.target.id,
			sourceDir,
			sourcePath: review.target.sourcePath ?? null,
			sha256: review.target.sha256 ?? null,
			bytes: review.target.bytes ?? 0,
			decision: review.decision,
		},
		wrapperSkill: {
			id: prepared.manifest?.id ?? null,
			name: prepared.manifest?.name ?? null,
			sourceUri,
		},
		engine: {
			binding: "source:v1",
			providerId: provider.pluginId,
			sourceRef,
		},
		plan: prepared.plan
			? {
				schema: prepared.plan.schema,
				capabilityRequests: prepared.plan.capabilityRequests,
				engineBindings: prepared.plan.engineBindings,
			}
			: null,
		decision: decisionResult?.decision
			? {
				schema: decisionResult.decision.schema,
				decision: decisionResult.decision.decision,
				requiresRuntimeDispatch: decisionResult.decision.requiresRuntimeDispatch,
				executed: decisionResult.decision.executed,
			}
			: null,
		receipt: receiptResult?.receipt
			? {
				schema: receiptResult.receipt.schema,
				status: receiptResult.receipt.status,
				engineCalls: receiptResult.receipt.engineCalls,
				output: receiptResult.receipt.output,
				completedAt: receiptResult.receipt.completedAt,
				executed: receiptResult.receipt.executed,
			}
			: null,
		sourceStatus: statusCall?.ok ? statusCall.value : null,
		boundaries: [
			"This smoke reads vault-seed dgk-skills/vault-search as source evidence only.",
			"This smoke does not install, copy, vendor, or execute the external DGK skill.",
			"This smoke executes only source:v1 status through @refarm.dev/source-local.",
			"This smoke does not execute dgk, Obsidian CLI, runtime-agent, pi-agent, shell tools, file mutations, or model calls.",
			"Dirty or untracked upstream checkout status is recorded as evidence, not hidden or normalized.",
		],
		nextActions: issues.length === 0
			? [
				"Treat DGK vault-search as the first external skill fixture proof for @refarm.dev/skill-contract-v1.",
				"Keep DGK vocabulary and Obsidian behavior downstream-owned until a runtime host policy proof exists.",
			]
			: [
				"Fix DGK source review or wrapper receipt issues before claiming external DGK skill dogfood.",
			],
		issueCount: issues.length,
		issues,
	};
}

function parseArgs(argv = []) {
	const args = argv.filter((arg) => arg !== "--");
	const json = args.includes("--json");
	const sourceDirIndex = args.indexOf("--source-dir");
	const skillIndex = args.indexOf("--skill");
	const sourceDir = sourceDirIndex >= 0 ? args[sourceDirIndex + 1] : undefined;
	const skillName = skillIndex >= 0 ? args[skillIndex + 1] : undefined;
	const known = new Set(["--json", "--source-dir", "--skill", sourceDir, skillName]);
	const unknown = args.filter((arg) => !known.has(arg));
	if (sourceDirIndex >= 0 && !sourceDir) unknown.push("--source-dir");
	if (skillIndex >= 0 && !skillName) unknown.push("--skill");
	return { json, sourceDir, skillName, unknown };
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	const { json, sourceDir, skillName, unknown } = parseArgs(process.argv.slice(2));
	if (unknown.length > 0) {
		console.error(`Unknown argument: ${unknown[0]}`);
		process.exit(1);
	}
	const result = await buildNativeSkillDgkVaultSearchSmoke({
		root: process.cwd(),
		...(sourceDir ? { sourceDir } : {}),
		...(skillName ? { skillName } : {}),
	});
	if (json) {
		console.log(JSON.stringify(result, null, 2));
	} else if (result.ok) {
		console.log("native-skill-dgk-vault-search-smoke: ok");
	} else {
		console.log(`native-skill-dgk-vault-search-smoke: blocked (${result.issueCount} issue(s))`);
		for (const item of result.issues) {
			console.log(`- ${item.code}: ${item.message}`);
		}
	}
	if (!result.ok) process.exit(1);
}
