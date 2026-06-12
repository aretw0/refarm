import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	createMockManifest,
	validatePluginManifest,
} from "../../packages/plugin-manifest/src/index.js";

export const ISSUED_AT = "2026-01-01T00:00:00.000Z";
export const TASK_ID = "task-extension-sandbox-poc";
export const EFFORT_ID = "effort-extension-sandbox-poc-001";
export const RUN_ID = "extension-sandbox-poc-001";

const GRANTED_CAPABILITIES = ["storage:v1"];
const LIFECYCLE_STEPS = ["setup", "ingest", "teardown"];

function sha256Text(value) {
	return createHash("sha256").update(value).digest("hex");
}

function jsonText(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function manifestFor(id, overrides = {}) {
	return createMockManifest({
		id,
		name: id.replace("@example/", "").replace(/-/g, " "),
		entry: "extension.wasm",
		integrity: `sha256-${"a".repeat(64)}`,
		targets: ["server"],
		...overrides,
	});
}

function missingCapabilities(manifest, grants = GRANTED_CAPABILITIES) {
	return manifest.capabilities.requires.filter((capability) => !grants.includes(capability));
}

function lifecycleEvents(manifest, status = "ok") {
	return LIFECYCLE_STEPS.map((step, index) => ({
		index: index + 1,
		pluginId: manifest.id,
		step,
		status,
		recordedAt: ISSUED_AT,
	}));
}

function evaluatePlugin(manifest, policyMode) {
	const validation = validatePluginManifest(manifest);
	const missing = validation.valid ? missingCapabilities(manifest) : [];

	if (!validation.valid) {
		return {
			pluginId: manifest.id,
			status: "invalid-manifest",
			policyMode,
			manifestValid: false,
			manifestErrors: validation.errors,
			missingCapabilities: [],
			events: [],
		};
	}

	if (missing.length > 0) {
		return {
			pluginId: manifest.id,
			status: policyMode === "fail-fast" ? "blocked-fail-fast" : "blocked-warn-continue",
			policyMode,
			manifestValid: true,
			manifestErrors: [],
			missingCapabilities: missing,
			events: [],
		};
	}

	if (manifest.id.includes("failing")) {
		return {
			pluginId: manifest.id,
			status: policyMode === "fail-fast" ? "failed-aborted" : "failed-isolated",
			policyMode,
			manifestValid: true,
			manifestErrors: [],
			missingCapabilities: [],
			events: [
				...lifecycleEvents(manifest).slice(0, 1),
				{
					index: 2,
					pluginId: manifest.id,
					step: "ingest",
					status: "error",
					recordedAt: ISSUED_AT,
				},
			],
		};
	}

	return {
		pluginId: manifest.id,
		status: "completed",
		policyMode,
		manifestValid: true,
		manifestErrors: [],
		missingCapabilities: [],
		events: lifecycleEvents(manifest),
	};
}

function evaluatePolicy(policyMode) {
	const manifests = [
		manifestFor("@example/benign-extension", {
			capabilities: {
				provides: ["example:report"],
				requires: ["storage:v1"],
				providesApi: [],
				requiresApi: [],
			},
		}),
		manifestFor("@example/denied-extension", {
			capabilities: {
				provides: ["example:network-report"],
				requires: ["network:v1"],
				providesApi: [],
				requiresApi: [],
			},
		}),
		manifestFor("@example/failing-extension", {
			capabilities: {
				provides: ["example:failing-report"],
				requires: ["storage:v1"],
				providesApi: [],
				requiresApi: [],
			},
		}),
	];
	const plugins = manifests.map((manifest) => evaluatePlugin(manifest, policyMode));
	const failed = plugins.some((plugin) =>
		["blocked-fail-fast", "failed-aborted", "invalid-manifest"].includes(plugin.status),
	);

	return {
		policyMode,
		grantedCapabilities: GRANTED_CAPABILITIES,
		hostStatus: failed && policyMode === "fail-fast" ? "aborted" : "continued",
		plugins,
	};
}

export function runExtensionSandboxPoc() {
	const policies = [evaluatePolicy("warn+continue"), evaluatePolicy("fail-fast")];
	const allPlugins = policies.flatMap((policy) => policy.plugins);
	const allEvents = allPlugins.flatMap((plugin) => plugin.events);
	const policyDecision = buildPolicyDecision(policies);

	return {
		id: "extension-sandbox-poc",
		createdAt: ISSUED_AT,
		question:
			"Can a local host validate extension manifests, enforce explicit capability grants, record lifecycle events, and handle failures according to policy?",
		scope: {
			data: "synthetic",
			externalServices: false,
			wasmRuntime: "simulated-lifecycle",
		},
		policyDecision,
		policies,
		checks: {
			benignCompleted: allPlugins.some(
				(plugin) => plugin.pluginId === "@example/benign-extension" && plugin.status === "completed",
			),
			deniedBlocked: allPlugins.some(
				(plugin) =>
					plugin.pluginId === "@example/denied-extension" &&
					plugin.missingCapabilities.includes("network:v1"),
			),
			warnContinueSurvivesFailure: policies.some(
				(policy) =>
					policy.policyMode === "warn+continue" &&
					policy.hostStatus === "continued" &&
					policy.plugins.some((plugin) => plugin.status === "failed-isolated"),
			),
			failFastAbortsFailure: policies.some(
				(policy) =>
					policy.policyMode === "fail-fast" &&
					policy.hostStatus === "aborted" &&
					policy.plugins.some((plugin) => plugin.status === "failed-aborted"),
			),
			lifecycleEventsRecorded: allEvents.length,
		},
	};
}

export function buildPolicyDecision(policies) {
	const strictPolicy = policies.find((policy) => policy.policyMode === "fail-fast");
	const deniedPlugins = policies
		.flatMap((policy) => policy.plugins)
		.filter((plugin) => plugin.missingCapabilities.length > 0)
		.map((plugin) => ({
			pluginId: plugin.pluginId,
			policyMode: plugin.policyMode,
			missingCapabilities: plugin.missingCapabilities,
			outcome: plugin.status,
		}));
	const isolatedFailures = policies
		.flatMap((policy) => policy.plugins)
		.filter((plugin) => plugin.status === "failed-isolated")
		.map((plugin) => plugin.pluginId);

	return {
		id: "policy-decision-extension-sandbox-001",
		decidedAt: ISSUED_AT,
		subject: "synthetic extension host policy",
		requiredCapabilities: GRANTED_CAPABILITIES,
		defaultMode: "fail-fast",
		recommendedHostStatus: strictPolicy?.hostStatus ?? "unknown",
		deniedPlugins,
		isolatedFailures,
		operatorReview: {
			required: true,
			reason:
				"Synthetic host policy changed plugin execution outcomes; a human operator must review denied capabilities before granting them.",
		},
	};
}

export function buildPilotScorecard(report) {
	const scores = {
		manifestPolicy: report.checks.deniedBlocked ? 5 : 0,
		lifecycleEvidence: report.checks.lifecycleEventsRecorded >= 6 ? 5 : 2,
		failureIsolation: report.checks.warnContinueSurvivesFailure ? 5 : 0,
		strictAbort: report.checks.failFastAbortsFailure ? 5 : 0,
		humanReview: report.policyDecision.operatorReview.required ? 4 : 0,
	};
	const weights = {
		manifestPolicy: 0.25,
		lifecycleEvidence: 0.2,
		failureIsolation: 0.2,
		strictAbort: 0.2,
		humanReview: 0.15,
	};
	const finalScore = weightedScore(scores, weights);

	return {
		id: "scorecard-extension-sandbox-001",
		createdAt: ISSUED_AT,
		scale: 5,
		gate: finalScore >= 4.5 ? "continue" : "needs-human-review",
		finalScore,
		scores,
		weights,
		thresholds: {
			continue: 4.5,
			needsHumanReview: 3.5,
			doNotScaleBelow: 3.5,
		},
		limits: [
			"Simulated lifecycle only; this scorecard does not prove real WASM execution.",
			"Capability expansion must remain human-reviewed before adoption.",
		],
	};
}

export function buildRiskAndStandardsMatrix(report) {
	return {
		id: "risk-and-standards-extension-sandbox-001",
		createdAt: ISSUED_AT,
		conformanceClaim: false,
		frameworks: [
			{
				id: "wasi-component-model-direction",
				name: "WASI Component Model direction",
				stance: "architecture-alignment",
				note:
					"This POC models manifest, capability, lifecycle, and failure controls without claiming real WASM execution.",
			},
			{
				id: "least-privilege-extension-hosting",
				name: "Least-privilege extension hosting",
				stance: "control-pressure",
				note:
					"Requested capabilities are compared against explicit grants before lifecycle events are accepted.",
			},
		],
		controls: [
			{
				id: "manifest-validation",
				risk: "extension declares invalid or ambiguous authority",
				evidence: ["sandbox-report.json", "task-artefacts.json"],
				status: report.checks.benignCompleted ? "demonstrated" : "needs-work",
			},
			{
				id: "capability-denial",
				risk: "extension expands host authority without review",
				evidence: ["policy-decision.json"],
				status: report.checks.deniedBlocked ? "demonstrated" : "needs-work",
			},
			{
				id: "failure-isolation",
				risk: "extension failure takes down the host in permissive mode",
				evidence: ["sandbox-report.md"],
				status: report.checks.warnContinueSurvivesFailure ? "demonstrated" : "needs-work",
			},
		],
		gaps: [
			{
				id: "real-wasm-runtime",
				neededForClaim: "real plugin execution",
				nextEvidence: "Link this POC to an exercised WASM runtime command.",
			},
			{
				id: "production-policy-lifecycle",
				neededForClaim: "production plugin governance",
				nextEvidence: "Exercise install, deny, quarantine, review, and recovery commands.",
			},
		],
	};
}

export function buildRuntimeEvidence(report) {
	return {
		id: "runtime-evidence-extension-sandbox-001",
		createdAt: ISSUED_AT,
		claim: "real WebAssembly plugin lifecycle has an adjacent validation path",
		claimStatus: "adjacent-validation",
		syntheticPocScope: report.scope.wasmRuntime,
		evidenceCommands: [
			{
				id: "hello-world-wasm-build",
				command: "pnpm --filter @refarm.dev/hello-world-plugin run build",
				proves: "Rust source can build a WASI Preview 1 WebAssembly component artifact.",
				cost: "medium",
			},
			{
				id: "browser-plugin-lifecycle-e2e",
				command:
					"pnpm -C validations/wasm-plugin/host run test:e2e:chromium",
				proves:
					"Browser host can load the transpiled component and exercise setup, ingest, metadata, and teardown.",
				cost: "high",
			},
			{
				id: "tractor-jco-integration",
				command: "pnpm --filter @refarm.dev/tractor run test -- test/jco-integration.test.ts",
				proves:
					"JCO is available and the compiled hello-world plugin binary is recognized when present.",
				cost: "medium",
			},
		],
		linkedEvidence: [
			"validations/wasm-plugin/VALIDATION_RESULTS.md",
			"validations/wasm-plugin/host/tests/e2e/plugin-lifecycle.spec.ts",
			"packages/tractor-ts/test/jco-integration.test.ts",
		],
		promotionBoundary: {
			canSay:
				"The extension sandbox policy POC is linked to a real WASM validation path.",
			cannotSay:
				"The synthetic sandbox report itself executed real WASM plugins in production governance.",
		},
		nextPromotion:
			"Run the dedicated E2E command in the target environment and attach its output before claiming real execution in proposal text.",
	};
}

export function buildSandboxReportMarkdown(report) {
	const rows = report.policies
		.flatMap((policy) =>
			policy.plugins.map((plugin) =>
				`| ${policy.policyMode} | ${plugin.pluginId} | ${plugin.status} | ${plugin.missingCapabilities.join(", ") || "none"} | ${plugin.events.length} |`,
			),
		)
		.join("\n");

	return `# Extension Sandbox PoC Report

Scope: synthetic local validation only. No real plugins, services, institutional data, or secrets are used.

| Policy | Plugin | Outcome | Missing capabilities | Lifecycle events |
| --- | --- | --- | --- | ---: |
${rows}

## Checks

- Benign extension completed: ${report.checks.benignCompleted}
- Denied extension blocked: ${report.checks.deniedBlocked}
- Warn+continue survives isolated failure: ${report.checks.warnContinueSurvivesFailure}
- Fail-fast aborts on failure: ${report.checks.failFastAbortsFailure}
- Lifecycle events recorded: ${report.checks.lifecycleEventsRecorded}

## Policy Decision

- Default mode: ${report.policyDecision.defaultMode}
- Recommended host status: ${report.policyDecision.recommendedHostStatus}
- Operator review required: ${report.policyDecision.operatorReview.required}
`;
}

export function buildScenarioMarkdown(report) {
	return `# Extension Sandbox PoC Scenario

Scope: synthetic local validation only. No real plugins, services, institutional data, or secrets are used.

## Problem

A local host needs to accept extensions without letting optional code silently expand its authority. The scenario asks whether the host can verify manifests, enforce declared capability grants, record lifecycle evidence, and choose a safe outcome when an extension is denied or fails.

## Actors

- Operator: reviews capability grants and promotion decisions.
- Host: validates manifests and executes the synthetic lifecycle.
- Extension: requests capabilities and reports lifecycle events.

## Decision Points

1. A benign extension requests only granted capabilities and should complete.
2. A denied extension requests \`network:v1\` and should be blocked.
3. A failing extension should be isolated in warn+continue mode.
4. The same failing extension should abort the flow in fail-fast mode.

## Outcome

The synthetic run evaluated ${report.policies.length} policy modes and ${report.policies.reduce(
		(total, policy) => total + policy.plugins.length,
		0,
)} plugin-policy combinations. The recommended strict host status is \`${report.policyDecision.recommendedHostStatus}\` and human review remains required before expanding capability grants.
`;
}

export function buildAnnexMarkdown(report, scorecard) {
	const scoreRows = Object.entries(scorecard.scores)
		.map(([criterion, score]) => {
			const weight = scorecard.weights[criterion];
			return `| ${criterion} | ${score} | ${weight} | ${evidenceForSandboxCriterion(criterion)} |`;
		})
		.join("\n");
	const flowRows = [
		["1", "Manifest submitted", "Validate schema and integrity metadata", "invalid-manifest or accepted for policy evaluation"],
		["2", "Capabilities requested", "Compare requested capabilities with grant", "blocked or allowed"],
		["3", "Lifecycle invoked", "Record setup, ingest, and teardown events", "completed or failed path"],
		["4", "Failure handled", "Apply warn+continue or fail-fast policy", "continued or aborted host status"],
		["5", "Pilot reviewed", "Read policy decision and scorecard", "continue or needs-human-review gate"],
	]
		.map((row) => `| ${row.join(" | ")} |`)
		.join("\n");

	return `# Extension Sandbox PoC Annex

## Flow Table

| Step | Event | Control | Output |
| ---: | --- | --- | --- |
${flowRows}

## Evidence Map

| Claim | Generated evidence |
| --- | --- |
| Manifest and capability boundaries are checked | \`sandbox-report.json\`, \`policy-decision.json\` |
| Denied capabilities remain reviewable | \`policy-decision.json\` denied plugin list |
| Failure mode changes are explicit | \`sandbox-report.md\` policy table |
| Pilot decision is measurable | \`scorecard.json\` |

## Scorecard Criteria

| Criterion | Score | Weight | Evidence |
| --- | ---: | ---: | --- |
${scoreRows}

## Reader Path

1. Read \`scenario.md\` for the operational question.
2. Inspect \`policy-decision.json\` for the review decision.
3. Inspect \`scorecard.json\` for the gate and limits.
4. Use \`task-artefacts.json\` to verify hashes and provenance.
`;
}

function weightedScore(scores, weights) {
	const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
	const total = Object.entries(scores).reduce(
		(sum, [key, score]) => sum + score * (weights[key] ?? 0),
		0,
	);
	return Math.round((total / totalWeight) * 100) / 100;
}

function evidenceForSandboxCriterion(criterion) {
	const evidence = {
		manifestPolicy: "Denied extension records missing capabilities.",
		lifecycleEvidence: "Lifecycle events are recorded for completed and failed paths.",
		failureIsolation: "Warn+continue keeps the host running after isolated failure.",
		strictAbort: "Fail-fast aborts on the failing extension path.",
		humanReview: "Policy decision requires operator review.",
	};
	return evidence[criterion] ?? "Synthetic report evidence.";
}

export function buildTaskArtefactManifest(writtenArtifacts) {
	const roles = {
		"sandbox-report.json": "dataset",
		"policy-decision.json": "receipt",
		"scorecard.json": "report",
		"risk-and-standards-matrix.json": "report",
		"runtime-evidence.json": "report",
		"scenario.md": "report",
		"annex.md": "report",
		"sandbox-report.md": "report",
	};
	const labels = {
		"scorecard.json": ["scorecard", "pilot"],
		"risk-and-standards-matrix.json": ["risk", "standards", "claim-promotion"],
		"runtime-evidence.json": ["runtime", "wasm", "claim-promotion"],
		"scenario.md": ["scenario", "reader-path"],
		"annex.md": ["annex", "evidence-map"],
	};

	return {
		schema: "refarm.task-artefacts.v1",
		taskId: TASK_ID,
		effortId: EFFORT_ID,
		createdAt: ISSUED_AT,
		artefacts: Object.entries(writtenArtifacts).map(([fileName, contents]) => ({
			id: fileName.replace(/\./g, "-"),
			uri: fileName,
			mediaType: fileName.endsWith(".md") ? "text/markdown" : "application/json",
			role: roles[fileName] ?? "other",
			hash: {
				algorithm: "sha256",
				value: sha256Text(contents),
			},
			reviewState: "accepted",
			provenance: {
				runId: RUN_ID,
				producer: "extension-sandbox:poc",
				command: "pnpm run extension-sandbox:poc",
				source: "validations/extension-sandbox-poc",
				sourceVersion: "synthetic-v1",
				producedAt: ISSUED_AT,
			},
			...(labels[fileName] ? { labels: labels[fileName] } : {}),
		})),
	};
}

export function writeArtifacts(outDir) {
	const report = runExtensionSandboxPoc();
	const scorecard = buildPilotScorecard(report);
	const riskAndStandardsMatrix = buildRiskAndStandardsMatrix(report);
	const runtimeEvidence = buildRuntimeEvidence(report);
	const writtenArtifacts = {
		"sandbox-report.json": jsonText(report),
		"policy-decision.json": jsonText(report.policyDecision),
		"scorecard.json": jsonText(scorecard),
		"risk-and-standards-matrix.json": jsonText(riskAndStandardsMatrix),
		"runtime-evidence.json": jsonText(runtimeEvidence),
		"scenario.md": buildScenarioMarkdown(report),
		"annex.md": buildAnnexMarkdown(report, scorecard),
		"sandbox-report.md": buildSandboxReportMarkdown(report),
	};
	const manifest = buildTaskArtefactManifest(writtenArtifacts);

	mkdirSync(outDir, { recursive: true });
	for (const [fileName, contents] of Object.entries(writtenArtifacts)) {
		writeFileSync(path.join(outDir, fileName), contents);
	}
	writeFileSync(path.join(outDir, "task-artefacts.json"), jsonText(manifest));
	return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const outDir =
		process.argv[2] ??
		path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "expected");
	const report = writeArtifacts(outDir);
	console.log(
		JSON.stringify(
			{
				ok: true,
				outDir,
				policies: report.policies.length,
				pluginsEvaluated: report.policies.reduce(
					(total, policy) => total + policy.plugins.length,
					0,
				),
				lifecycleEventsRecorded: report.checks.lifecycleEventsRecorded,
				warnContinueSurvivesFailure: report.checks.warnContinueSurvivesFailure,
				failFastAbortsFailure: report.checks.failFastAbortsFailure,
			},
			null,
			2,
		),
	);
}
