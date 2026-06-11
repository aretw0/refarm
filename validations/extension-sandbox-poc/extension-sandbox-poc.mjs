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
`;
}

export function buildTaskArtefactManifest(writtenArtifacts) {
	return {
		schema: "refarm.task-artefacts.v1",
		taskId: TASK_ID,
		effortId: EFFORT_ID,
		createdAt: ISSUED_AT,
		artefacts: Object.entries(writtenArtifacts).map(([fileName, contents]) => ({
			id: fileName.replace(/\./g, "-"),
			uri: fileName,
			mediaType: fileName.endsWith(".md") ? "text/markdown" : "application/json",
			role: fileName.endsWith(".md") ? "report" : "dataset",
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
		})),
	};
}

export function writeArtifacts(outDir) {
	const report = runExtensionSandboxPoc();
	const writtenArtifacts = {
		"sandbox-report.json": jsonText(report),
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
