import chalk from "chalk";
import { Command } from "commander";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	buildDiagnosticNextActionPayload,
	diagnosticNextActions,
	diagnosticNextCommands,
	type DiagnosticRecommendation,
} from "./diagnostic-recommendations.js";
import {
	buildRefarmDoctorReport,
	type RefarmDoctorReport,
} from "./doctor.js";
import { type HealthReport, runHealthAudit } from "./health.js";
import { printJson } from "./json-output.js";
import {
	buildModelDoctorStatus,
	defaultModelDeps,
	type ModelDoctorStatus,
} from "./model.js";
import { resolveStatusPayload } from "./status.js";

const NODE_SUBSTRATE_ENVIRONMENT_COMMAND = "Run validation inside the environment that owns this node_modules tree, or rebuild/reopen the devcontainer so node_modules is isolated per platform.";
const NODE_SUBSTRATE_INSTALL_COMMAND = "Run the package-manager install command for this environment, then retry `refarm check --next-action --json`.";

export interface NodeSubstrateCheck {
	command: "node-substrate";
	operation: "check";
	ok: boolean;
	platform: NodeJS.Platform;
	missing: string[];
	foreignPlatformShims: Array<{
		binary: string;
		expected: string;
		found: string;
	}>;
	recommendations: DiagnosticRecommendation[];
}

export interface RefarmCheckReport {
	command: "check";
	operation: "readiness";
	ok: boolean;
	failureCount: number;
	warningCount: number;
	checks: {
		health: HealthReport;
		doctor: RefarmDoctorReport;
		model?: ModelDoctorStatus;
		nodeSubstrate?: NodeSubstrateCheck;
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
}

export function buildRefarmCheckReport(checks: {
	health: HealthReport;
	doctor: RefarmDoctorReport;
	model?: ModelDoctorStatus;
	nodeSubstrate?: NodeSubstrateCheck;
}): RefarmCheckReport {
	const recommendations: DiagnosticRecommendation[] = [
		...(checks.nodeSubstrate?.recommendations ?? []),
		...checks.health.recommendations,
		...checks.doctor.recommendations,
		...modelDoctorCheckRecommendations(checks.model),
	];
	const blockingRecommendations = recommendations.filter(isBlockingRecommendation);
	const failureCount =
		(checks.nodeSubstrate?.ok === false ? 1 : 0) +
		(checks.health.ok ? 0 : checks.health.issueCount) +
		checks.doctor.failureCount;

	const nextActions = diagnosticNextActions(blockingRecommendations);
	const nextCommands = diagnosticNextCommands(blockingRecommendations);
	return {
		command: "check",
		operation: "readiness",
		ok: (checks.nodeSubstrate?.ok ?? true) && checks.health.ok && checks.doctor.ok,
		failureCount,
		warningCount:
			checks.doctor.warningCount +
			modelDoctorCheckRecommendations(checks.model).length,
		checks,
		recommendations,
		nextAction: nextActions[0] ?? null,
		nextActions,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
	};
}

function modelDoctorCheckRecommendations(
	model: ModelDoctorStatus | undefined,
): DiagnosticRecommendation[] {
	return (model?.recommendations ?? []).map((recommendation) => ({
		...recommendation,
		severity: "warning",
	}));
}

function isBlockingRecommendation(recommendation: DiagnosticRecommendation): boolean {
	return recommendation.severity !== "warning" && recommendation.severity !== "info";
}

function printRefarmCheckSummary(report: RefarmCheckReport): void {
	console.log(chalk.bold(`Check: ${report.ok ? "PASS" : "FAIL"}`));
	if (report.checks.nodeSubstrate) {
		console.log(
			`Node substrate: ${report.checks.nodeSubstrate.ok ? "pass" : "fail"} (${report.checks.nodeSubstrate.missing.length} missing, ${report.checks.nodeSubstrate.foreignPlatformShims.length} foreign shims)`,
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
				chalk.gray(
					`  - ${recommendation.diagnostic}${target}: ${recommendation.summary}`,
				),
			);
			console.log(chalk.gray(`    ${recommendation.action}`));
		}
	}
}

function printRefarmCheckNextActionJson(report: RefarmCheckReport): void {
	const output: RefarmCheckNextActionJson = buildDiagnosticNextActionPayload({
		ok: report.ok,
		nextActions: report.nextActions,
		nextCommands: report.nextCommands,
		recommendations: compactActionableRecommendations(report.recommendations),
	});
	printJson(output);
}

function compactActionableRecommendations(
	recommendations: DiagnosticRecommendation[],
): DiagnosticRecommendation[] {
	const seen = new Set<string>();
	const compact: DiagnosticRecommendation[] = [];
	for (const recommendation of recommendations) {
		if (!isBlockingRecommendation(recommendation)) continue;
		const key = `${recommendation.action}\n${recommendation.command ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		compact.push(recommendation);
	}
	return compact;
}

async function runDefaultDoctor(options: {
	failOnWarnings?: boolean;
}): Promise<RefarmDoctorReport> {
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
	const deps = defaultModelDeps();
	const tokens = await deps.loadTokens();
	return buildModelDoctorStatus(tokens);
}

async function exists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

function expectedBinaryName(binary: string, platform: NodeJS.Platform): string {
	return platform === "win32" ? `${binary}.cmd` : binary;
}

function foreignBinaryName(binary: string, platform: NodeJS.Platform): string {
	return platform === "win32" ? binary : `${binary}.cmd`;
}

async function runDefaultNodeSubstrate(): Promise<NodeSubstrateCheck> {
	const root = process.cwd();
	const platform = os.platform();
	const missing: string[] = [];
	const foreignPlatformShims: NodeSubstrateCheck["foreignPlatformShims"] = [];
	for (const relativePath of [
		"node_modules",
		"path:node_modules/.bin",
		...["vitest", "tsc", "eslint"].map(
			(binary) => `bin:${binary}`,
		),
	]) {
		if (relativePath.startsWith("bin:")) {
			const binary = relativePath.slice("bin:".length);
			const expected = path.join(
				"node_modules",
				".bin",
				expectedBinaryName(binary, platform),
			);
			if (!(await exists(path.join(root, expected)))) {
				missing.push(expected);
				const found = path.join(
					"node_modules",
					".bin",
					foreignBinaryName(binary, platform),
				);
				if (await exists(path.join(root, found))) {
					foreignPlatformShims.push({ binary, expected, found });
				}
			}
			continue;
		}
		const relative = relativePath.startsWith("path:")
			? relativePath.slice("path:".length)
			: relativePath;
		if (!(await exists(path.join(root, relative)))) missing.push(relative);
	}
	const recommendations = buildNodeSubstrateRecommendations({
		missing,
		foreignPlatformShims,
	});
	return {
		command: "node-substrate",
		operation: "check",
		ok: recommendations.length === 0,
		platform,
		missing,
		foreignPlatformShims,
		recommendations,
	};
}

function buildNodeSubstrateRecommendations(input: {
	missing: string[];
	foreignPlatformShims: NodeSubstrateCheck["foreignPlatformShims"];
}): DiagnosticRecommendation[] {
	if (input.foreignPlatformShims.length > 0) {
		return [
			{
				diagnostic: "node-substrate:foreign-platform-shims",
				severity: "failure",
				summary: "node_modules contains package-manager shims for a different platform.",
				action: NODE_SUBSTRATE_ENVIRONMENT_COMMAND,
				target: input.foreignPlatformShims
					.map((shim) => `${shim.found} -> ${shim.expected}`)
					.join(", "),
			},
		];
	}
	if (input.missing.length > 0) {
		return [
			{
				diagnostic: "node-substrate:missing-package-manager-bins",
				severity: "failure",
				summary: "node_modules is missing package-manager execution shims required by Refarm checks.",
				action: NODE_SUBSTRATE_INSTALL_COMMAND,
				command: "pnpm install --frozen-lockfile",
				target: input.missing.join(", "),
			},
		];
	}
	return [];
}

export function createCheckCommand(
	deps: RefarmCheckDeps = {
		runHealth: runHealthAudit,
		runDoctor: runDefaultDoctor,
		runModelDoctor: runDefaultModelDoctor,
		runNodeSubstrate: runDefaultNodeSubstrate,
	},
): Command {
	return new Command("check")
		.description("Run the cheap composite readiness gate")
		.option("--json", "Output machine-readable composite report")
		.option("--next-action", "Print only the first blocking recovery action")
		.option("--next-command", "Print only the first executable recovery command")
		.option("--fail-on-warnings", "Treat doctor warning diagnostics as failures")
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
  Use it before a commit or handoff when you need a quick local confidence signal.
`,
		)
		.action(async (options: RefarmCheckOptions) => {
			const nodeSubstrate = await deps.runNodeSubstrate?.();
			const health = await deps.runHealth();
			const doctor = await deps.runDoctor({
				failOnWarnings: options.failOnWarnings,
			});
			const model = await deps.runModelDoctor?.();
			const report = buildRefarmCheckReport({
				nodeSubstrate,
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
