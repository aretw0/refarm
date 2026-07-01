#!/usr/bin/env node
import { readFileSync } from "node:fs";
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
import { buildAgentsLabSkillConventionReview } from "./agents-lab-skill-convention-review.mjs";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_SOURCE_DIR =
	process.env.AGENTS_LAB_SOURCE_DIR ??
	"/home/vscode/.cache/checkouts/github.com/aretw0/agents-lab";
const DEFAULT_SOURCE_URI = "fixture:agents-lab/git-workflow-refarm-wrapper/SKILL.md";
const SCHEMA_VERSION = 1;

export function buildRefarmGitWorkflowWrapperSkill({ upstreamPath, upstreamSha256 }) {
	return `---
name: agents-lab-git-workflow-refarm-wrapper
description: >
  Refarm operator wrapper for agents-lab git-workflow source evidence.
requiredCapabilities:
  - refarm.operator-loop
  - source:v1
engineBindings:
  - source:v1
input: Markdown task context describing the external agents-lab checkout to inspect before git workflow advice.
inputRequired: true
output: Markdown source and convention evidence for the wrapped git workflow.
---

# Agents Lab Git Workflow Refarm Wrapper

Start with \`refarm resume --json\` and \`refarm check --next-action --json\`.
Respect Refarm source sovereignty and never edit generated artifacts.
Run \`refarm agent finish --lane after-edit --run --json\` after source edits.
Run \`refarm agent finish --lane after-commit --run --json\` after an atomic commit.
Require explicit confirmation before destructive or wide-impact git operations.

The upstream agents-lab skill is source evidence, not installed runtime code:

- source path: ${upstreamPath}
- source sha256: ${upstreamSha256}
`;
}

function issue(code, message, evidence = null) {
	return {
		code,
		message,
		...(evidence ? { evidence } : {}),
	};
}

function formatWrappedOutput({ review, status, sourceDir }) {
	return [
		"# Agents Lab git-workflow wrapper evidence",
		"",
		`- source checkout: ${sourceDir}`,
		`- source skill: ${review.target.sourcePath}`,
		`- source sha256: ${review.target.sha256}`,
		`- convention decision: ${review.decision}`,
		`- source kind: ${status.kind}`,
		`- source materialized: ${String(status.materialized)}`,
		`- source clean: ${String(status.clean)}`,
		`- source dirty: ${String(status.dirty)}`,
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

export async function buildNativeSkillAgentsLabGitWorkflowSmoke({
	root = DEFAULT_ROOT,
	sourceDir = DEFAULT_SOURCE_DIR,
	sourceUri = DEFAULT_SOURCE_URI,
	completedAt,
} = {}) {
	const issues = [];
	const review = buildAgentsLabSkillConventionReview({ root, sourceDir });
	if (!review.ok) {
		issues.push(issue(
			"AGENTS_LAB_CONVENTION_REVIEW_NOT_READY",
			"Expected agents-lab git-workflow convention review to pass before wrapper smoke.",
			review.issues,
		));
	}
	if (review.decision !== "requires-refarm-wrapper-before-install") {
		issues.push(issue(
			"AGENTS_LAB_GIT_WORKFLOW_DECISION_UNEXPECTED",
			"Expected agents-lab git-workflow to require a Refarm wrapper before installation.",
			review.decision,
		));
	}
	if (!review.target.sourcePath || !review.target.sha256) {
		issues.push(issue(
			"AGENTS_LAB_GIT_WORKFLOW_SOURCE_MISSING",
			"Expected convention review to expose source path and SHA-256 evidence.",
			review.target,
		));
	}

	const upstreamPath = review.target.sourcePath ?? "unknown";
	const upstreamSha256 = review.target.sha256 ?? "unknown";
	const wrapperSkill = buildRefarmGitWorkflowWrapperSkill({ upstreamPath, upstreamSha256 });
	const prepared = prepareSkillInvocationPlan(wrapperSkill, { sourceUri });
	if (!prepared.ok || !prepared.manifest || !prepared.plan) {
		issues.push(issue(
			"WRAPPER_SKILL_PLAN_NOT_READY",
			"Expected Refarm git-workflow wrapper to prepare a policy-checkable plan.",
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
			`Inspect agents-lab checkout ${sourceDir} before wrapping git workflow guidance.`,
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
			"AGENTS_LAB_SOURCE_ENGINE_STATUS_FAILED",
			"Expected source-local status engine call to succeed for agents-lab checkout.",
			statusCall.error,
		));
	}

	const upstreamSkillText = review.target.sourcePath
		? readFileSync(path.join(sourceDir, review.target.sourcePath), "utf8")
		: "";
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
		command: "native-skill-agents-lab-git-workflow-smoke",
		ok: issues.length === 0,
		mode: "external-skill-wrapper-dogfood-smoke",
		executesRuntimeAgent: false,
		executesEngine: Boolean(statusCall),
		installsExternalSkill: false,
		selectedExternalSkill: {
			id: "git-skills",
			sourceDir,
			sourcePath: review.target.sourcePath ?? null,
			sha256: review.target.sha256 ?? null,
			bytes: Buffer.byteLength(upstreamSkillText),
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
			"This smoke reads agents-lab git-workflow as source evidence only.",
			"This smoke does not install, copy, vendor, or execute the external skill.",
			"This smoke executes only source:v1 status through @refarm.dev/source-local.",
			"This smoke does not execute runtime-agent, pi-agent, shell tools, file mutations, or model calls.",
		],
		nextActions: issues.length === 0
			? [
				"Promote the wrapper only as package-declared skill surface evidence, not as an external skill install.",
				"Use the same wrapper/evidence pattern for one DGK skill when the downstream source is ready.",
			]
			: [
				"Fix convention review or wrapper receipt issues before claiming external skill dogfood.",
			],
		issueCount: issues.length,
		issues,
	};
}

function parseArgs(argv = []) {
	const args = argv.filter((arg) => arg !== "--");
	const json = args.includes("--json");
	const sourceDirIndex = args.indexOf("--source-dir");
	const sourceDir = sourceDirIndex >= 0 ? args[sourceDirIndex + 1] : undefined;
	const known = new Set(["--json", "--source-dir", sourceDir]);
	const unknown = args.filter((arg) => !known.has(arg));
	if (sourceDirIndex >= 0 && !sourceDir) unknown.push("--source-dir");
	return { json, sourceDir, unknown };
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	const { json, sourceDir, unknown } = parseArgs(process.argv.slice(2));
	if (unknown.length > 0) {
		console.error(`Unknown argument: ${unknown[0]}`);
		process.exit(1);
	}
	const result = await buildNativeSkillAgentsLabGitWorkflowSmoke({
		root: process.cwd(),
		...(sourceDir ? { sourceDir } : {}),
	});
	if (json) {
		console.log(JSON.stringify(result, null, 2));
	} else if (result.ok) {
		console.log("native-skill-agents-lab-git-workflow-smoke: ok");
	} else {
		console.log(`native-skill-agents-lab-git-workflow-smoke: blocked (${result.issueCount} issue(s))`);
		for (const item of result.issues) {
			console.log(`- ${item.code}: ${item.message}`);
		}
	}
	if (!result.ok) process.exit(1);
}
