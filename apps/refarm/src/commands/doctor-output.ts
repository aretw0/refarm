import { formatRefarmStatusJson } from "@refarm.dev/cli/status";
import { buildDiagnosticNextActionPayload } from "./diagnostic-recommendations.js";
import type { RefarmDoctorReport } from "./doctor.js";
import { formatJson } from "./json-output.js";

export type RefarmDoctorOutputMode =
	| "json"
	| "next-action"
	| "next-action-json"
	| "next-command"
	| "next-command-json"
	| "summary";

export function resolveDoctorOutputMode(options: {
	json?: boolean;
	nextAction?: boolean;
	nextCommand?: boolean;
}): RefarmDoctorOutputMode {
	if (options.nextCommand && options.json) return "next-command-json";
	if (options.nextCommand) return "next-command";
	if (options.nextAction && options.json) return "next-action-json";
	if (options.nextAction) return "next-action";
	return options.json ? "json" : "summary";
}

export function formatRefarmDoctorReportJson(
	report: RefarmDoctorReport,
): string {
	return formatJson(
		{
			command: report.command,
			operation: report.operation,
			ok: report.ok,
			failureCount: report.failureCount,
			warningCount: report.warningCount,
			failures: report.failures,
			warnings: report.warnings,
			informational: report.informational,
			recommendations: report.recommendations,
			nextAction: report.nextAction,
			nextActions: report.nextActions,
			nextCommand: report.nextCommand,
			nextCommands: report.nextCommands,
			host: report.host,
			status: JSON.parse(formatRefarmStatusJson(report.status)),
		},
	);
}

export function printRefarmDoctorReport(
	report: RefarmDoctorReport,
	log: (message: string) => void = console.log,
): void {
	const state = report.ok ? "PASS" : "FAIL";
	log(`Doctor: ${state}`);
	log(
		`Host: ${report.host.command} v${report.host.version} (${report.host.app}, profile=${report.host.profile}, packageManager=${report.host.packageManager})`,
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

export function printRefarmDoctorNextAction(
	report: RefarmDoctorReport,
	log: (message: string) => void = console.log,
): void {
	const [action] = report.nextActions;
	if (action) log(action);
}

export function printRefarmDoctorNextCommand(
	report: RefarmDoctorReport,
	log: (message: string) => void = console.log,
): void {
	const [command] = report.nextCommands;
	if (command) log(command);
}

export function formatRefarmDoctorNextActionJson(
	report: RefarmDoctorReport,
): string {
	return formatJson(
		buildDiagnosticNextActionPayload({
			ok: report.ok,
			nextActions: report.nextActions,
			nextCommands: report.nextCommands,
			recommendations: report.recommendations.filter(
				(recommendation) => recommendation.severity !== "info",
			),
		}),
	);
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

	if (options.mode === "next-action") {
		printRefarmDoctorNextAction(options.report, options.log);
		return;
	}

	if (options.mode === "next-action-json") {
		const log = options.log ?? console.log;
		log(formatRefarmDoctorNextActionJson(options.report));
		return;
	}

	if (options.mode === "next-command") {
		printRefarmDoctorNextCommand(options.report, options.log);
		return;
	}

	if (options.mode === "next-command-json") {
		const log = options.log ?? console.log;
		log(formatRefarmDoctorNextActionJson(options.report));
		return;
	}

	printRefarmDoctorReport(options.report, options.log);
}
