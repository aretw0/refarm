#!/usr/bin/env node
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

const DEFAULT_SOURCE_URI = "fixture:refarm-source-status/SKILL.md";
const SCHEMA_VERSION = 1;

export const REFARM_SOURCE_STATUS_SKILL = `---
name: refarm-source-status
description: >
  Refarm source status workflow using the source:v1 engine.
requiredCapabilities:
  - refarm.operator-loop
  - source:v1
engineBindings:
  - source:v1
input: Markdown task context describing which local source tree the host should inspect.
inputRequired: true
output: Markdown source status report.
---

# Refarm Source Status

Inspect the selected local source tree through the Refarm source:v1 engine.
Report materialization, cleanliness, head, and untracked-path evidence.
`;

function issue(code, message, evidence = null) {
	return {
		code,
		message,
		...(evidence ? { evidence } : {}),
	};
}

function formatStatusReport(status, sourceRef) {
	return [
		"# Source status",
		"",
		`- source: ${sourceRef}`,
		`- kind: ${status.kind}`,
		`- materialized: ${String(status.materialized)}`,
		`- clean: ${String(status.clean)}`,
		`- dirty: ${String(status.dirty)}`,
		`- untracked: ${String(status.untracked)}`,
		`- head: ${status.head ?? "unknown"}`,
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

export async function buildNativeSkillSourceEngineSmoke({
	skillMarkdown = REFARM_SOURCE_STATUS_SKILL,
	sourceUri = DEFAULT_SOURCE_URI,
	sourceRef = "local:.",
	cwd = process.cwd(),
	completedAt,
} = {}) {
	const issues = [];
	const prepared = prepareSkillInvocationPlan(skillMarkdown, { sourceUri });
	if (!prepared.ok || !prepared.manifest || !prepared.plan) {
		issues.push(issue(
			"SKILL_PLAN_NOT_READY",
			"Expected source status SKILL.md to prepare a policy-checkable invocation plan.",
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

	const requestResult = prepared.plan
		? buildSkillInvocationRequest(prepared.plan, `Inspect ${sourceRef} with source:v1.`)
		: null;
	if (requestResult && (!requestResult.ok || !requestResult.request)) {
		issues.push(issue(
			"SKILL_INVOCATION_REQUEST_NOT_READY",
			"Expected invocation plan to build a source status request.",
			requestResult.issues,
		));
	}

	const decisionResult = requestResult?.request
		? buildSkillInvocationDecision(requestResult.request, {
			decision: "approved",
			reason: "Smoke host approved the declared source:v1 status capability.",
			approvedCapabilities: requestResult.request.capabilityRequests
				.filter((item) => item.required)
				.map((item) => item.id),
		})
		: null;
	if (decisionResult && (!decisionResult.ok || !decisionResult.decision)) {
		issues.push(issue(
			"SKILL_INVOCATION_DECISION_NOT_READY",
			"Expected invocation request to build a source status policy decision.",
			decisionResult.issues,
		));
	}

	const provider = createLocalSourceProvider({
		pluginId: "@refarm.dev/source-local",
		cwd,
	});
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
			"SOURCE_ENGINE_STATUS_FAILED",
			"Expected source-local status engine call to succeed.",
			statusCall.error,
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
						body: formatStatusReport(statusCall.value, sourceRef),
					},
				}
				: { error: statusCall?.error ?? "source:v1 status failed" }),
		})
		: null;
	if (receiptResult && (!receiptResult.ok || !receiptResult.receipt)) {
		issues.push(issue(
			"SKILL_INVOCATION_RECEIPT_NOT_READY",
			"Expected approved source status invocation to build an execution receipt.",
			receiptResult.issues,
		));
	}

	return {
		schemaVersion: SCHEMA_VERSION,
		command: "native-skill-source-engine-smoke",
		ok: issues.length === 0,
		mode: "source-engine-dogfood-smoke",
		executesRuntimeAgent: false,
		executesEngine: Boolean(statusCall),
		selectedSkill: {
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
			"This smoke calls source:v1 through @refarm.dev/source-local only.",
			"This smoke does not execute runtime-agent, pi-agent, shell tools, file mutations, or model calls.",
			"The receipt is execution evidence for the source engine call, not a general skill runtime.",
		],
		nextActions: issues.length === 0
			? [
				"Select one external DGK or agents-lab skill fixture that can use the same source:v1 evidence boundary.",
				"Attach runtime-agent evidence only after policy, cancellation, observability, and cost-control proofs exist.",
			]
			: [
				"Fix the source engine smoke before claiming native skill engine dogfood.",
			],
		issueCount: issues.length,
		issues,
	};
}

function parseArgs(argv = []) {
	const args = argv.filter((arg) => arg !== "--");
	const json = args.includes("--json");
	const sourceIndex = args.indexOf("--source");
	const sourceRef = sourceIndex >= 0 ? args[sourceIndex + 1] : undefined;
	const unknown = args.filter((arg, index) =>
		arg !== "--json" &&
		arg !== "--source" &&
		index !== sourceIndex + 1
	);
	return { json, sourceRef, unknown };
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
	const { json, sourceRef, unknown } = parseArgs(process.argv.slice(2));
	if (unknown.length > 0) {
		console.error(`Unknown argument: ${unknown[0]}`);
		process.exit(1);
	}
	const result = await buildNativeSkillSourceEngineSmoke({ sourceRef });
	if (json) {
		console.log(JSON.stringify(result, null, 2));
	} else if (result.ok) {
		console.log("native-skill-source-engine-smoke: ok");
	} else {
		console.log(`native-skill-source-engine-smoke: blocked (${result.issueCount} issue(s))`);
		for (const item of result.issues) {
			console.log(`- ${item.code}: ${item.message}`);
		}
	}
	if (!result.ok) process.exit(1);
}
