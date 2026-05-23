import { formatRefarmStatusJson } from "@refarm.dev/cli/status";
import type { RefarmDoctorReport } from "./doctor.js";

export type RefarmDoctorOutputMode = "json" | "summary";

export function resolveDoctorOutputMode(options: {
	json?: boolean;
}): RefarmDoctorOutputMode {
	return options.json ? "json" : "summary";
}

export function formatRefarmDoctorReportJson(
	report: RefarmDoctorReport,
): string {
	return JSON.stringify(
		{
			ok: report.ok,
			failureCount: report.failureCount,
			warningCount: report.warningCount,
			failures: report.failures,
			warnings: report.warnings,
			informational: report.informational,
			recommendations: report.recommendations,
			nextActions: report.nextActions,
			host: report.host,
			status: JSON.parse(formatRefarmStatusJson(report.status)),
		},
		null,
		2,
	);
}

export function printRefarmDoctorReport(
	report: RefarmDoctorReport,
	log: (message: string) => void = console.log,
): void {
	const state = report.ok ? "PASS" : "FAIL";
	log(`Doctor: ${state}`);
	log(
		`Host: ${report.host.command} v${report.host.version} (${report.host.app}, profile=${report.host.profile})`,
	);
	log(
		`Renderer: ${report.status.renderer.id} (${report.status.renderer.kind})`,
	);
	const runtimeEngine = report.status.runtime.engine;
	const runtimeEngineSuffix = runtimeEngine
		? ` (engine=${runtimeEngine.activeEngine ?? "unknown"}, configured=${runtimeEngine.configuredEngine ?? "unknown"})`
		: "";
	log(
		`Runtime: ${report.status.runtime.ready ? "ready" : "not ready"}${runtimeEngineSuffix}`,
	);

	if (report.failures.length > 0) {
		log("Failures:");
		for (const code of report.failures) {
			log(`  - ${code}`);
		}
	}

	if (report.warnings.length > 0) {
		log("Warnings:");
		for (const code of report.warnings) {
			log(`  - ${code}`);
		}
	}

	if (report.informational.length > 0) {
		log("Info:");
		for (const code of report.informational) {
			log(`  - ${code}`);
		}
	}

	const blockingRecommendations = report.recommendations.filter(
		(item) => item.severity !== "info",
	);
	if (blockingRecommendations.length > 0) {
		log("Recommendations:");
		for (const item of blockingRecommendations) {
			log(`  - ${item.diagnostic}: ${item.summary}`);
			log(`    ${item.action}`);
		}
	}
}

export function emitRefarmDoctorOutput(options: {
	report: RefarmDoctorReport;
	mode: RefarmDoctorOutputMode;
	log?: (message: string) => void;
}): void {
	if (options.mode === "json") {
		const log = options.log ?? console.log;
		log(formatRefarmDoctorReportJson(options.report));
		return;
	}

	printRefarmDoctorReport(options.report, options.log);
}
