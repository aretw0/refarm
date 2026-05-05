import {
	classifyRefarmStatusDiagnostics,
	type RefarmStatusJson,
} from "@refarm.dev/cli/status";
import { Command } from "commander";
import {
	emitRefarmDoctorOutput,
	resolveDoctorOutputMode,
} from "./doctor-output.js";
import {
	resolveRefarmRuntimeMetadata,
	type RefarmRuntimeMetadata,
} from "./runtime-metadata.js";
import { withResolvedStatusPayload } from "./status-payload.js";
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
		const report = await withResolvedStatusPayload({
			resolveStatusPayload,
			resolveOptions: options,
			run: (status) => {
				const report = buildRefarmDoctorReport(status, {
					failOnWarnings: options.failOnWarnings,
				});
				const outputMode = resolveDoctorOutputMode(options);
				emitRefarmDoctorOutput({ report, mode: outputMode });
				return report;
			},
		});

		if (!report.ok) {
			process.exitCode = 1;
		}
	});
