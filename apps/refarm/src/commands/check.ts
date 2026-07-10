import type { RustSubstrateCheck } from "@refarm.dev/cli/rust-substrate";
import { Command } from "commander";

import { printJson } from "@refarm.dev/capabilities/envelope";
import { STATUS_DIAGNOSTICS } from "@refarm.dev/cli/status";
import { runDefaultNodeSubstrate } from "./check-node-substrate.js";
import type {
	EnvironmentPressureCheck,
	RefarmCheckDeps,
	RefarmCheckOptions,
	ReleasePolicyCheck,
	WorkspaceSweepCheck,
} from "./check-report.js";
import {
	buildRefarmCheckReport,
	printRefarmCheckNextActionJson,
	printRefarmCheckSummary,
} from "./check-report.js";
import {
	buildDiagnosticNextActionPayload,
	type DiagnosticRecommendation,
} from "./diagnostic-recommendations.js";
import type { RefarmDoctorReport } from "./doctor.js";
import type { ModelDoctorStatus } from "./model.js";
import type { WorkspaceExecutionStatus } from "./workspace-execution.js";

export type { RustSubstrateCheck } from "@refarm.dev/cli/rust-substrate";
export { buildNodeSubstrateRecommendations } from "./check-node-substrate.js";
export type { NodeSubstrateCheck } from "./check-node-substrate.js";
export { buildRefarmCheckReport } from "./check-report.js";
export type {
	EnvironmentPressureCheck,
	RefarmCheckDeps,
	ReleasePolicyCheck,
	WorkspaceSweepCheck,
} from "./check-report.js";

async function runDefaultEnvironmentPressure(): Promise<EnvironmentPressureCheck> {
	const { buildEnvironmentPressureReport } = await import(
		"@refarm.dev/health/environment-pressure"
	);
	return buildEnvironmentPressureReport({
		guidance: {
			diskPressureAction:
				"Run `pnpm run clean:rust:check`, then choose the smallest cleanup tier from docs/local-disk-hygiene.md before broad builds.",
			diskPressureCommand: "pnpm run clean:rust:check",
			diskProbeFailureAction: "Run `pnpm run disk:check` only if disk pressure is suspected.",
			diskProbeFailureCommand: "pnpm run disk:check",
			memoryPressureAction:
				"Use explicit test files, bounded workers, and package-scoped checks until memory pressure drops.",
			gitGcLogAction:
				"Inspect `.git/gc.log`; do not run prune or destructive Git cleanup from an agent without explicit operator intent.",
		},
	});
}

async function runDefaultDoctor(options: {
	failOnWarnings?: boolean;
}): Promise<RefarmDoctorReport> {
	const [{ buildRefarmDoctorReport }, { resolveStatusPayload }] = await Promise.all([
		import("./doctor.js"),
		import("./status.js"),
	]);
	const statusPayload = await resolveStatusPayload({ renderer: "headless" });
	try {
		return buildRefarmDoctorReport(statusPayload.json, {
			failOnWarnings: options.failOnWarnings,
		});
	} finally {
		await statusPayload.shutdown?.();
	}
}

async function runDefaultModelDoctor(): Promise<ModelDoctorStatus> {
	const { buildModelDoctorStatus, defaultModelDeps } = await import("./model.js");
	const deps = defaultModelDeps();
	const tokens = await deps.loadTokens();
	return buildModelDoctorStatus(tokens);
}

async function runDefaultRustSubstrate(): Promise<RustSubstrateCheck> {
	const { runRustSubstrateCheck } = await import("@refarm.dev/cli/rust-substrate");
	return runRustSubstrateCheck();
}

async function runDefaultWorkspaceExecution(): Promise<WorkspaceExecutionStatus> {
	const { buildWorkspaceExecutionStatus } = await import("./workspace-execution.js");
	return buildWorkspaceExecutionStatus();
}

async function runDefaultWorkspaceSweep(): Promise<WorkspaceSweepCheck> {
	const { declaredWorkspacesFromConfig, loadConfig } = await import("@refarm.dev/config");
	const {
		buildWorkspaceExecutionSweepPayload,
		observeDeclaredWorkspacesExecution,
	} = await import("./workspace.js");
	const config = loadConfig(process.cwd());
	const observations = observeDeclaredWorkspacesExecution(
		declaredWorkspacesFromConfig(config, { baseDir: process.cwd() }),
		undefined,
	);
	return {
		command: "workspace",
		operation: "execution",
		ok: true,
		...buildWorkspaceExecutionSweepPayload(observations),
	};
}

async function runDefaultReleasePolicy(): Promise<ReleasePolicyCheck> {
	const recommendedCommand = "refarm release preflight --selection default --json";
	const engine = (await import("@refarm.dev/release-engine")) as {
		buildReleasePlan: (options: {
			cwd?: string;
			selectionId?: string;
			profileTags?: string[];
		}) => unknown;
		summarizePlan: (plan: unknown) => {
			ok: boolean;
			status: string;
			packageCount: number;
			packages: string[];
			profileTags: string[];
			packageProfiles: unknown[];
			blockers: unknown[];
		};
	};
	const plan = engine.buildReleasePlan({
		cwd: process.cwd(),
		selectionId: "default",
	});
	const summary = engine.summarizePlan(plan);
	return {
		command: "release",
		operation: "plan",
		ok: summary.ok,
		status: summary.status,
		packageCount: summary.packageCount,
		packages: summary.packages,
		profileTags: summary.profileTags,
		packageProfiles: summary.packageProfiles,
		blockers: summary.blockers,
		recommendedCommand,
	};
}

function isBlockingRecommendation(
	recommendation: DiagnosticRecommendation,
): boolean {
	return (
		recommendation.severity !== "warning" && recommendation.severity !== "info"
	);
}

function isRuntimePreflightFailureDoctorReport(
	report: RefarmDoctorReport,
): boolean {
	return (
		report.failures.includes(STATUS_DIAGNOSTICS.runtimeNotReady) ||
		report.failures.includes(STATUS_DIAGNOSTICS.runtimeSidecarAccessBlocked)
	);
}

export function createCheckCommand(
	deps: RefarmCheckDeps = {
		runHealth: async () => {
			const { runHealthAudit } = await import("./health.js");
			return runHealthAudit(process.cwd(), { cacheMode: "stable" });
		},
		runDoctor: runDefaultDoctor,
		runModelDoctor: runDefaultModelDoctor,
		runNodeSubstrate: runDefaultNodeSubstrate,
		runRustSubstrate: runDefaultRustSubstrate,
		runEnvironmentPressure: runDefaultEnvironmentPressure,
		runWorkspaceExecution: runDefaultWorkspaceExecution,
		runWorkspaceSweep: runDefaultWorkspaceSweep,
		runReleasePolicy: runDefaultReleasePolicy,
	},
): Command {
	return new Command("check")
		.description("Run the cheap composite readiness gate")
		.option("--json", "Output machine-readable composite report")
		.option("--next-action", "Print only the first blocking recovery action")
		.option(
			"--next-command",
			"Print only the first executable recovery command",
		)
		.option(
			"--fail-on-warnings",
			"Treat doctor warning diagnostics as failures",
		)
		.addHelpText(
			"after",
			`

Examples:
  $ refarm check
  $ refarm check --json
  $ refarm check --next-action
  $ refarm check --next-action --json
  $ refarm check --next-command
  $ refarm check --fail-on-warnings

Notes:
  check combines refarm health and refarm doctor into one low-cost gate.
  --next-action and --next-command skip advisory model/workspace/release checks.
  Use it before a commit or handoff when you need a quick local confidence signal.
`,
		)
		.action(async (options: RefarmCheckOptions) => {
			const nextActionOnly = Boolean(options.nextAction || options.nextCommand);
			let preflightDoctor: RefarmDoctorReport | undefined;
			if (nextActionOnly) {
				preflightDoctor = await deps.runDoctor({
					failOnWarnings: options.failOnWarnings,
				});
				if (isRuntimePreflightFailureDoctorReport(preflightDoctor)) {
					const recommendations = preflightDoctor.recommendations.filter(
						isBlockingRecommendation,
					);
					const payload = buildDiagnosticNextActionPayload({
						ok: false,
						nextActions: preflightDoctor.nextActions,
						nextCommands: preflightDoctor.nextCommands,
						recommendations,
					});
					if (options.json) {
						printJson(payload);
					} else if (options.nextCommand) {
						const [command] = payload.nextCommands;
						if (command) console.log(command);
					} else {
						const [action] = payload.nextActions;
						if (action) console.log(action);
					}
					process.exitCode = 1;
					return;
				}
			}
			const [
				doctor,
				nodeSubstrate,
				rustSubstrate,
				environmentPressure,
				health,
				model,
				workspaceExecution,
				workspaceSweep,
				releasePolicy,
			] = await Promise.all([
				preflightDoctor ?? deps.runDoctor({
					failOnWarnings: options.failOnWarnings,
				}),
				deps.runNodeSubstrate?.(),
				deps.runRustSubstrate?.(),
				deps.runEnvironmentPressure?.(),
				deps.runHealth(),
				nextActionOnly ? undefined : deps.runModelDoctor?.(),
				nextActionOnly ? undefined : deps.runWorkspaceExecution?.(),
				nextActionOnly ? undefined : deps.runWorkspaceSweep?.(),
				nextActionOnly ? undefined : deps.runReleasePolicy?.(),
			]);
			const report = buildRefarmCheckReport({
				nodeSubstrate,
				rustSubstrate,
				environmentPressure,
				workspaceExecution,
				workspaceSweep,
				releasePolicy,
				health,
				doctor,
				model,
			});

			if (options.nextCommand && options.json) {
				printRefarmCheckNextActionJson(report);
			} else if (options.nextCommand) {
				const [command] = report.nextCommands;
				if (command) console.log(command);
			} else if (options.nextAction && options.json) {
				printRefarmCheckNextActionJson(report);
			} else if (options.nextAction) {
				const [action] = report.nextActions;
				if (action) console.log(action);
			} else if (options.json) {
				printJson(report);
			} else {
				printRefarmCheckSummary(report);
			}

			if (!report.ok) {
				process.exitCode = 1;
			}
		});
}

export const checkCommand = createCheckCommand();
