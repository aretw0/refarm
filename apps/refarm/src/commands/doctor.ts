import {
	classifyRefarmStatusDiagnostics,
	formatRefarmStatusJson,
	type RefarmStatusJson,
} from "@refarm.dev/cli/status";
import { Command } from "commander";
import {
	resolveRefarmRuntimeMetadata,
	type RefarmRuntimeMetadata,
} from "./runtime-metadata.js";
import { resolveStatusPayload } from "./status.js";

export interface RefarmDoctorReport {
	ok: boolean;
	failureCount: number;
	warningCount: number;
	failures: string[];
	warnings: string[];
	informational: string[];
	host: RefarmRuntimeMetadata;
	status: RefarmStatusJson;
}

export interface RefarmDoctorOptions {
	renderer?: string;
	input?: string;
	json?: boolean;
	failOnWarnings?: boolean;
}

export function buildRefarmDoctorReport(
	status: RefarmStatusJson,
	options: { failOnWarnings?: boolean; metadata?: RefarmRuntimeMetadata } = {},
): RefarmDoctorReport {
	const { failures, warnings, informational } =
		classifyRefarmStatusDiagnostics(status);

	const failOnWarnings = options.failOnWarnings === true;
	const ok =
		failures.length === 0 && (!failOnWarnings || warnings.length === 0);

	return {
		ok,
		failureCount: failures.length,
		warningCount: warnings.length,
		failures,
		warnings,
		informational,
		host:
			options.metadata ??
			resolveRefarmRuntimeMetadata({
				app: status.host.app,
				command: status.host.command,
				profile: status.host.profile,
			}),
		status,
	};
}

function printReport(report: RefarmDoctorReport): void {
	const state = report.ok ? "PASS" : "FAIL";
	console.log(`Doctor: ${state}`);
	console.log(
		`Host: ${report.host.command} v${report.host.version} (${report.host.app}, profile=${report.host.profile})`,
	);
	console.log(
		`Renderer: ${report.status.renderer.id} (${report.status.renderer.kind})`,
	);
	console.log(
		`Runtime: ${report.status.runtime.ready ? "ready" : "not ready"}`,
	);

	if (report.failures.length > 0) {
		console.log("Failures:");
		for (const code of report.failures) console.log(`  - ${code}`);
	}

	if (report.warnings.length > 0) {
		console.log("Warnings:");
		for (const code of report.warnings) console.log(`  - ${code}`);
	}

	if (report.informational.length > 0) {
		console.log("Info:");
		for (const code of report.informational) console.log(`  - ${code}`);
	}
}

function formatDoctorReportJson(report: RefarmDoctorReport): string {
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

export const doctorCommand = new Command("doctor")
	.description("Run host readiness checks from the refarm status contract")
	.option(
		"--input <path>",
		"Read status payload from JSON file (or '-' for stdin) instead of booting runtime",
	)
	.option(
		"--renderer <kind>",
		"Renderer mode when booting runtime: web | tui | headless",
		"headless",
	)
	.option("--json", "Output machine-readable doctor report")
	.option("--fail-on-warnings", "Treat warning diagnostics as failures")
	.action(async (options: RefarmDoctorOptions) => {
		const { json: status, shutdown } = await resolveStatusPayload(options);
		const report = buildRefarmDoctorReport(status, {
			failOnWarnings: options.failOnWarnings,
		});

		if (options.json) {
			console.log(formatDoctorReportJson(report));
		} else {
			printReport(report);
		}

		if (!report.ok) {
			process.exitCode = 1;
		}

		await shutdown?.();
	});
