import type { RustSubstrateCheck } from "@refarm.dev/cli/rust-substrate";
import chalk from "chalk";

import { printJson } from "@refarm.dev/capabilities/envelope";
import type { NodeSubstrateCheck } from "./check-node-substrate.js";
import {
	buildDiagnosticNextActionPayload,
	diagnosticNextActions,
	diagnosticNextCommands,
	type DiagnosticRecommendation,
} from "./diagnostic-recommendations.js";
import type { RefarmDoctorReport } from "./doctor.js";
import type { HealthReport } from "./health.js";
import type { ModelDoctorStatus } from "./model.js";
import type { WorkspaceExecutionStatus } from "./workspace-execution.js";
import {
	type WorkspaceExecutionObservation,
	type WorkspaceExecutionRecommendation,
	type WorkspaceExecutionSummary,
	type WorkspaceExecutionSweepPayload,
} from "./workspace.js";

export interface RefarmCheckReport {
	command: "check";
	operation: "readiness";
	warningsAsBlocking: boolean;
	ok: boolean;
	failureCount: number;
	warningCount: number;
	checks: {
		health: HealthReport;
		doctor: RefarmDoctorReport;
		model?: ModelDoctorStatus;
		nodeSubstrate?: NodeSubstrateCheck;
		rustSubstrate?: RustSubstrateCheck;
		environmentPressure?: EnvironmentPressureCheck;
		workspaceExecution?: WorkspaceExecutionStatus;
		workspaceSweep?: WorkspaceSweepCheck;
		releasePolicy?: ReleasePolicyCheck;
	};
	recommendations: DiagnosticRecommendation[];
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
}

export interface RefarmCheckNextActionJson {
	ok: boolean;
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
}

export interface RefarmCheckOptions {
	json?: boolean;
	nextAction?: boolean;
	nextCommand?: boolean;
	failOnWarnings?: boolean;
}

export interface RefarmCheckDeps {
	runHealth(): Promise<HealthReport>;
	runDoctor(options: { failOnWarnings?: boolean }): Promise<RefarmDoctorReport>;
	runModelDoctor?(): Promise<ModelDoctorStatus>;
	runNodeSubstrate?(): Promise<NodeSubstrateCheck>;
	runRustSubstrate?(): Promise<RustSubstrateCheck>;
	runEnvironmentPressure?(): Promise<EnvironmentPressureCheck>;
	runWorkspaceExecution?(): Promise<WorkspaceExecutionStatus>;
	runWorkspaceSweep?(): Promise<WorkspaceSweepCheck>;
	runReleasePolicy?(): Promise<ReleasePolicyCheck>;
}

export type EnvironmentPressureDecision = "continue" | "safe-mode" | "stop-and-investigate";

export interface EnvironmentPressureSignal {
	id: string;
	kind: "filesystem" | "memory" | "git" | "cache" | "session";
	severity: "info" | "warning" | "failure";
	ok: boolean;
	summary: string;
	action: string | null;
	command?: string | null;
	path?: string;
	freeMiB?: number;
	totalMiB?: number;
	usedRatio?: number | null;
	error?: string;
}

export interface EnvironmentPressureCheck {
	command: string;
	operation: string;
	ok: boolean;
	decision: EnvironmentPressureDecision;
	signals: EnvironmentPressureSignal[];
	recommendations: DiagnosticRecommendation[];
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
}

export interface WorkspaceSweepCheck {
	command: "workspace";
	operation: "execution";
	ok: boolean;
	mode: WorkspaceExecutionSweepPayload["mode"];
	summary: WorkspaceExecutionSummary;
	recommendations: WorkspaceExecutionRecommendation[];
	observations: WorkspaceExecutionObservation[];
}

export interface ReleasePolicyCheck {
	command: "release";
	operation: "plan";
	ok: boolean;
	status: string;
	packageCount: number;
	packages: string[];
	profileTags: string[];
	packageProfiles: unknown[];
	blockers: unknown[];
	recommendedCommand: string;
}

export function buildRefarmCheckReport(checks: {
	health: HealthReport;
	doctor: RefarmDoctorReport;
	model?: ModelDoctorStatus;
	nodeSubstrate?: NodeSubstrateCheck;
	rustSubstrate?: RustSubstrateCheck;
	environmentPressure?: EnvironmentPressureCheck;
	workspaceExecution?: WorkspaceExecutionStatus;
	workspaceSweep?: WorkspaceSweepCheck;
	releasePolicy?: ReleasePolicyCheck;
}, options: { warningsAsBlocking?: boolean } = {}): RefarmCheckReport {
	const warningsAsBlocking = options.warningsAsBlocking === true;
	const recommendations: DiagnosticRecommendation[] = [
		...(checks.nodeSubstrate?.recommendations ?? []),
		...(checks.rustSubstrate?.recommendations ?? []),
		...(checks.environmentPressure?.recommendations ?? []),
		...workspaceExecutionCheckRecommendations(checks.workspaceExecution),
		...workspaceSweepCheckRecommendations(checks.workspaceSweep),
		...releasePolicyCheckRecommendations(checks.releasePolicy),
		...checks.health.recommendations,
		...checks.doctor.recommendations,
		...modelDoctorCheckRecommendations(checks.model),
	];
	const blockingRecommendations = recommendations.filter((recommendation) =>
		isBlockingRecommendation(recommendation, warningsAsBlocking),
	);
	const failureCount =
		(checks.nodeSubstrate?.ok === false ? 1 : 0) +
		(checks.rustSubstrate?.ok === false ? 1 : 0) +
		(checks.environmentPressure?.ok === false ? 1 : 0) +
		(checks.health.ok ? 0 : checks.health.issueCount) +
		checks.doctor.failureCount;

	const nextActions = diagnosticNextActions(blockingRecommendations);
	const nextCommands = diagnosticNextCommands(blockingRecommendations);
	return {
		command: "check",
		operation: "readiness",
		warningsAsBlocking,
		ok:
			(checks.nodeSubstrate?.ok ?? true) &&
			(checks.rustSubstrate?.ok ?? true) &&
			(checks.environmentPressure?.ok ?? true) &&
			checks.health.ok &&
			checks.doctor.ok,
		failureCount,
		warningCount:
			(checks.nodeSubstrate?.recommendations ?? []).filter(
				(recommendation) => recommendation.severity === "warning",
			).length +
			(checks.rustSubstrate?.recommendations ?? []).filter(
				(recommendation) => recommendation.severity === "warning",
			).length +
			(checks.environmentPressure?.recommendations ?? []).filter(
				(recommendation) => recommendation.severity === "warning",
			).length +
			checks.doctor.warningCount +
			workspaceExecutionCheckRecommendations(checks.workspaceExecution).filter(
				(recommendation) => recommendation.severity === "warning",
			).length +
			workspaceSweepCheckRecommendations(checks.workspaceSweep).filter(
				(recommendation) => recommendation.severity === "warning",
			).length +
			checks.health.recommendations.filter(
				(recommendation) => recommendation.severity === "warning",
			).length +
			modelDoctorCheckRecommendations(checks.model).length,
		checks,
		recommendations,
		nextAction: nextActions[0] ?? null,
		nextActions,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
	};
}

function releasePolicyCheckRecommendations(
	releasePolicy: ReleasePolicyCheck | undefined,
): DiagnosticRecommendation[] {
	if (!releasePolicy) return [];
	return [
		{
			diagnostic: "release-policy:kernel-candidates",
			severity: "info",
			summary: `Release policy currently selects ${releasePolicy.packageCount} kernel candidate package${releasePolicy.packageCount === 1 ? "" : "s"}.`,
			action:
				"Inspect the release plan and supply posture before preparing npm or crates publication.",
			command: releasePolicy.recommendedCommand,
		},
	];
}

function workspaceSweepCheckRecommendations(
	sweep: WorkspaceSweepCheck | undefined,
): DiagnosticRecommendation[] {
	if (!sweep) return [];
	return sweep.recommendations.map((recommendation) => ({
		diagnostic: `workspace-sweep:${recommendation.code}`,
		severity: recommendation.code === "workspace-path-missing" ? "warning" : "info",
		summary: recommendation.message,
		action: workspaceSweepRecommendationAction(recommendation),
		command: recommendation.nextCommand,
		target: recommendation.workspaceId,
	}));
}

function workspaceSweepRecommendationAction(
	recommendation: WorkspaceExecutionRecommendation,
): string {
	if (recommendation.code === "workspace-path-missing") {
		return (
			recommendation.mountHints?.[0] ??
			"Make the declared workspace path visible to this runtime, or update its bridge configuration."
		);
	}
	if (recommendation.code === "turbo-install-needed") {
		return "Declare Turbo in the target workspace so Refarm can use cache-aware validation.";
	}
	return "Provision or configure the declared remote cache for this workspace.";
}

function workspaceExecutionCheckRecommendations(
	execution: WorkspaceExecutionStatus | undefined,
): DiagnosticRecommendation[] {
	if (!execution) return [];
	const recommendations: DiagnosticRecommendation[] = [];
	const turbo = execution.adapters.turbo;
	if (turbo.configured && !turbo.declared && turbo.installCommand) {
		recommendations.push({
			diagnostic: "workspace-execution:turbo-adapter-unprovisioned",
			severity: "warning",
			summary: "Workspace has turbo.json, but the Turbo adapter is not declared in package.json.",
			action:
				"Declare Turbo in the workspace so Refarm can use cache-aware validation, or remove turbo.json if direct package scripts are intentional.",
			command: turbo.installCommand,
			target: execution.root,
		});
	}
	if (turbo.available && !execution.cache.remote.configured) {
		recommendations.push({
			diagnostic: "workspace-execution:remote-cache-not-configured",
			severity: "info",
			summary:
				"Workspace validation can use the local Turbo cache, but no remote cache credentials are configured.",
			action:
				"Provision or configure a remote cache when validation should get hits across machines and containers.",
			command: execution.cache.remote.provisionCommand,
			target: execution.root,
		});
	}
	return recommendations;
}

function modelDoctorCheckRecommendations(
	model: ModelDoctorStatus | undefined,
): DiagnosticRecommendation[] {
	return (model?.recommendations ?? []).map((recommendation) => ({
		...recommendation,
		severity: "warning",
	}));
}

function isBlockingRecommendation(
	recommendation: DiagnosticRecommendation,
	warningsAsBlocking = false,
): boolean {
	if (recommendation.severity === "info") return false;
	if (recommendation.severity === "warning") return warningsAsBlocking;
	return true;
}

export function printRefarmCheckSummary(report: RefarmCheckReport): void {
	console.log(chalk.bold(`Check: ${report.ok ? "PASS" : "FAIL"}`));
	if (report.checks.nodeSubstrate) {
		console.log(
			`Node substrate: ${report.checks.nodeSubstrate.ok ? "pass" : "fail"} (${report.checks.nodeSubstrate.missing.length} missing, ${report.checks.nodeSubstrate.foreignPlatformShims.length} foreign shims, ${report.checks.nodeSubstrate.mountIssues.length} mount issues, ${report.checks.nodeSubstrate.missingWorkspaceDependencyLinks.length} workspace links, ${report.checks.nodeSubstrate.missingRuntimeDependencies.length} runtime deps, ${report.checks.nodeSubstrate.sourceAccessIssueCount} source access issues)`,
		);
	}
	if (report.checks.rustSubstrate?.required) {
		console.log(
			`Rust substrate: ${report.checks.rustSubstrate.ok ? "pass" : "fail"} (${report.checks.rustSubstrate.missing.length} missing)`,
		);
	}
	if (report.checks.environmentPressure) {
		console.log(
			`Environment pressure: ${report.checks.environmentPressure.decision} (${report.checks.environmentPressure.signals.length} signals)`,
		);
	}
	if (report.checks.workspaceExecution) {
		console.log(
			`Workspace execution: ${report.checks.workspaceExecution.executor.selected} (local cache ${report.checks.workspaceExecution.cache.local.available ? "available" : "not found"}, remote cache ${report.checks.workspaceExecution.cache.remote.configured ? "configured" : "not configured"})`,
		);
	}
	if (report.checks.workspaceSweep) {
		console.log(
			`Workspace sweep: ${report.checks.workspaceSweep.summary.ok}/${report.checks.workspaceSweep.summary.total} ready (${report.checks.workspaceSweep.summary.missingPath} missing path${report.checks.workspaceSweep.summary.missingPath === 1 ? "" : "s"}, ${report.checks.workspaceSweep.summary.remoteCacheUnconfigured} remote cache pending)`,
		);
	}
	if (report.checks.releasePolicy) {
		console.log(
			`Release policy: ${report.checks.releasePolicy.packageCount} kernel candidate${report.checks.releasePolicy.packageCount === 1 ? "" : "s"} (${report.checks.releasePolicy.profileTags.join(" + ")})`,
		);
	}
	console.log(
		`Health: ${report.checks.health.ok ? "pass" : "fail"} (${report.checks.health.issueCount} issue${report.checks.health.issueCount === 1 ? "" : "s"})`,
	);
	console.log(
		`Doctor: ${report.checks.doctor.ok ? "pass" : "fail"} (${report.checks.doctor.failureCount} failure${report.checks.doctor.failureCount === 1 ? "" : "s"}, ${report.checks.doctor.warningCount} warning${report.checks.doctor.warningCount === 1 ? "" : "s"})`,
	);
	if (report.checks.model) {
		const modelWarnings = modelDoctorCheckRecommendations(report.checks.model).length;
		console.log(
			`Model: ${modelWarnings === 0 ? "pass" : "warn"} (${modelWarnings} warning${modelWarnings === 1 ? "" : "s"})`,
		);
	}

	const actionable = report.recommendations.filter(
		(recommendation) => recommendation.severity !== "info",
	);
	if (actionable.length > 0) {
		console.log(chalk.bold("\nRecommendations"));
		for (const recommendation of actionable) {
			const target = recommendation.target ? ` (${recommendation.target})` : "";
			console.log(
				chalk.gray(`  - ${recommendation.diagnostic}${target}: ${recommendation.summary}`),
			);
			console.log(chalk.gray(`    ${recommendation.action}`));
		}
	}
}

export function printRefarmCheckNextActionJson(report: RefarmCheckReport): void {
	const output: RefarmCheckNextActionJson = buildDiagnosticNextActionPayload({
		ok: report.ok,
		nextActions: report.nextActions,
		nextCommands: report.nextCommands,
		recommendations: compactActionableRecommendations(
			report.recommendations,
			report.warningsAsBlocking,
		),
	});
	printJson(output);
}

function compactActionableRecommendations(
	recommendations: DiagnosticRecommendation[],
	warningsAsBlocking = false,
): DiagnosticRecommendation[] {
	const seen = new Set<string>();
	const compact: DiagnosticRecommendation[] = [];
	for (const recommendation of recommendations) {
		if (!isBlockingRecommendation(recommendation, warningsAsBlocking)) continue;
		const key = `${recommendation.action}\n${recommendation.command ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		compact.push(recommendation);
	}
	return compact;
}
