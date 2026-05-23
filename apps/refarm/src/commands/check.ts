import chalk from "chalk";
import { Command } from "commander";
import {
	diagnosticNextActions,
	type DiagnosticRecommendation,
} from "./diagnostic-recommendations.js";
import {
	buildRefarmDoctorReport,
	type RefarmDoctorReport,
} from "./doctor.js";
import { type HealthReport, runHealthAudit } from "./health.js";
import { resolveStatusPayload } from "./status.js";

export interface RefarmCheckReport {
	ok: boolean;
	failureCount: number;
	warningCount: number;
	checks: {
		health: HealthReport;
		doctor: RefarmDoctorReport;
	};
	recommendations: DiagnosticRecommendation[];
	nextActions: string[];
}

export interface RefarmCheckOptions {
	json?: boolean;
	failOnWarnings?: boolean;
}

export interface RefarmCheckDeps {
	runHealth(): Promise<HealthReport>;
	runDoctor(options: { failOnWarnings?: boolean }): Promise<RefarmDoctorReport>;
}

export function buildRefarmCheckReport(checks: {
	health: HealthReport;
	doctor: RefarmDoctorReport;
}): RefarmCheckReport {
	const recommendations: DiagnosticRecommendation[] = [
		...checks.health.recommendations,
		...checks.doctor.recommendations,
	];
	const failureCount =
		(checks.health.ok ? 0 : checks.health.issueCount) +
		checks.doctor.failureCount;

	return {
		ok: checks.health.ok && checks.doctor.ok,
		failureCount,
		warningCount: checks.doctor.warningCount,
		checks,
		recommendations,
		nextActions: diagnosticNextActions(recommendations),
	};
}

function printRefarmCheckSummary(report: RefarmCheckReport): void {
	console.log(chalk.bold(`Check: ${report.ok ? "PASS" : "FAIL"}`));
	console.log(
		`Health: ${report.checks.health.ok ? "pass" : "fail"} (${report.checks.health.issueCount} issue${report.checks.health.issueCount === 1 ? "" : "s"})`,
	);
	console.log(
		`Doctor: ${report.checks.doctor.ok ? "pass" : "fail"} (${report.checks.doctor.failureCount} failure${report.checks.doctor.failureCount === 1 ? "" : "s"}, ${report.checks.doctor.warningCount} warning${report.checks.doctor.warningCount === 1 ? "" : "s"})`,
	);

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

export function createCheckCommand(
	deps: RefarmCheckDeps = {
		runHealth: runHealthAudit,
		runDoctor: runDefaultDoctor,
	},
): Command {
	return new Command("check")
		.description("Run the cheap composite readiness gate")
		.option("--json", "Output machine-readable composite report")
		.option("--fail-on-warnings", "Treat doctor warning diagnostics as failures")
		.addHelpText(
			"after",
			`

Examples:
  $ refarm check
  $ refarm check --json
  $ refarm check --fail-on-warnings

Notes:
  check combines refarm health and refarm doctor into one low-cost gate.
  Use it before a commit or handoff when you need a quick local confidence signal.
`,
		)
		.action(async (options: RefarmCheckOptions) => {
			const [health, doctor] = await Promise.all([
				deps.runHealth(),
				deps.runDoctor({ failOnWarnings: options.failOnWarnings }),
			]);
			const report = buildRefarmCheckReport({ health, doctor });

			if (options.json) {
				console.log(JSON.stringify(report, null, 2));
			} else {
				printRefarmCheckSummary(report);
			}

			if (!report.ok) {
				process.exitCode = 1;
			}
		});
}

export const checkCommand = createCheckCommand();
