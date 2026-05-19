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
	recommendations: RefarmDoctorRecommendation[];
	host: RefarmRuntimeMetadata;
	status: RefarmStatusJson;
}

export interface RefarmDoctorRecommendation {
	diagnostic: string;
	severity: "failure" | "warning" | "info";
	summary: string;
	action: string;
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
		recommendations: buildRefarmDoctorRecommendations({
			failures,
			warnings,
			informational,
		}),
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

export function buildRefarmDoctorRecommendations(diagnostics: {
	failures: string[];
	warnings: string[];
	informational: string[];
}): RefarmDoctorRecommendation[] {
	return [
		...diagnostics.failures.map((diagnostic) =>
			createRefarmDoctorRecommendation(diagnostic, "failure"),
		),
		...diagnostics.warnings.map((diagnostic) =>
			createRefarmDoctorRecommendation(diagnostic, "warning"),
		),
		...diagnostics.informational.map((diagnostic) =>
			createRefarmDoctorRecommendation(diagnostic, "info"),
		),
	];
}

function createRefarmDoctorRecommendation(
	diagnostic: string,
	severity: RefarmDoctorRecommendation["severity"],
): RefarmDoctorRecommendation {
	switch (diagnostic) {
		case "runtime:not-ready":
			return {
				diagnostic,
				severity,
				summary: "The runtime reported that it is not ready.",
				action: "Start or repair the configured runtime, then rerun `refarm doctor --json`.",
			};
		case "trust:critical-present":
			return {
				diagnostic,
				severity,
				summary: "Critical trust diagnostics are present.",
				action: "Review trust policy and rejected capabilities before launching interactive surfaces.",
			};
		case "trust:warnings-present":
			return {
				diagnostic,
				severity,
				summary: "Trust warnings are present.",
				action: "Inspect trust warnings and decide whether they should block this workflow.",
			};
		case "plugins:rejected-surfaces-present":
			return {
				diagnostic,
				severity,
				summary: "One or more plugin surfaces were rejected.",
				action: "Inspect plugin manifests and host surface policy before exposing plugin UI.",
			};
		case "streams:active-present":
			return {
				diagnostic,
				severity,
				summary: "Runtime streams are still active.",
				action: "Wait for active streams to finish, or inspect stream telemetry before shutdown.",
			};
		case "plugins:surface-actions-available":
			return {
				diagnostic,
				severity,
				summary: "Plugin surface actions are available.",
				action: "Use the actions command or renderer action view to inspect available operations.",
			};
		case "renderer:non-interactive":
			return {
				diagnostic,
				severity,
				summary: "The selected renderer is non-interactive.",
				action: "Use a web or TUI renderer when the workflow requires interactive controls.",
			};
		case "renderer:no-rich-html":
			return {
				diagnostic,
				severity,
				summary: "The selected renderer does not support rich HTML.",
				action: "Use a renderer with rich HTML support when plugin surfaces require it.",
			};
		default:
			return {
				diagnostic,
				severity,
				summary: `Diagnostic ${diagnostic} is present.`,
				action: "Inspect the status payload and project policy for the diagnostic source.",
			};
	}
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
