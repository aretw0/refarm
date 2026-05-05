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
	log(`Runtime: ${report.status.runtime.ready ? "ready" : "not ready"}`);

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
