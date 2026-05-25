import {
	classifyRefarmStatusDiagnostics,
	REFARM_STATUS_DIAGNOSTICS,
	type RefarmStatusJson,
} from "@refarm.dev/cli/status";
import { Command } from "commander";
import {
	diagnosticNextActions,
	diagnosticNextCommands,
	type DiagnosticRecommendation,
	type DiagnosticRecommendationSeverity,
} from "./diagnostic-recommendations.js";
import {
	emitRefarmDoctorOutput,
	resolveDoctorOutputMode,
} from "./doctor-output.js";
import {
	resolveRefarmRuntimeMetadata,
	type RefarmRuntimeMetadata,
} from "./runtime-metadata.js";
import {
	RUNTIME_ENSURE_WAIT_COMMAND,
	RUNTIME_NOT_READY_RECOVERY_ACTION,
} from "./runtime-recovery.js";
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
	nextActions: string[];
	nextCommands: string[];
	host: RefarmRuntimeMetadata;
	status: RefarmStatusJson;
}

export interface RefarmDoctorRecommendation {
	diagnostic: DiagnosticRecommendation["diagnostic"];
	severity: DiagnosticRecommendationSeverity;
	summary: DiagnosticRecommendation["summary"];
	action: DiagnosticRecommendation["action"];
	command?: DiagnosticRecommendation["command"];
}

export interface RefarmDoctorOptions {
	renderer?: string;
	input?: string;
	json?: boolean;
	nextAction?: boolean;
	nextCommand?: boolean;
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
	const recommendations = buildRefarmDoctorRecommendations({
		failures,
		warnings,
		informational,
	});

	return {
		ok,
		failureCount: failures.length,
		warningCount: warnings.length,
		failures,
		warnings,
		informational,
		recommendations,
		nextActions: diagnosticNextActions(recommendations),
		nextCommands: diagnosticNextCommands(recommendations),
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
		case REFARM_STATUS_DIAGNOSTICS.runtimeNotReady:
			return {
				diagnostic,
				severity,
				summary: "The runtime reported that it is not ready.",
				action: RUNTIME_NOT_READY_RECOVERY_ACTION,
				command: RUNTIME_ENSURE_WAIT_COMMAND,
			};
		case REFARM_STATUS_DIAGNOSTICS.trustCriticalPresent:
			return {
				diagnostic,
				severity,
				summary: "Critical trust diagnostics are present.",
				action: "Review trust policy and rejected capabilities before launching interactive surfaces.",
			};
		case REFARM_STATUS_DIAGNOSTICS.trustWarningsPresent:
			return {
				diagnostic,
				severity,
				summary: "Trust warnings are present.",
				action: "Inspect trust warnings and decide whether they should block this workflow.",
			};
		case REFARM_STATUS_DIAGNOSTICS.pluginsRejectedSurfacesPresent:
			return {
				diagnostic,
				severity,
				summary: "One or more plugin surfaces were rejected.",
				action: "Inspect plugin manifests and host surface policy before exposing plugin UI.",
			};
		case REFARM_STATUS_DIAGNOSTICS.streamsActivePresent:
			return {
				diagnostic,
				severity,
				summary: "Runtime streams are still active.",
				action: "Wait for active streams to finish, or inspect stream telemetry before shutdown.",
			};
		case REFARM_STATUS_DIAGNOSTICS.pluginsSurfaceActionsAvailable:
			return {
				diagnostic,
				severity,
				summary: "Plugin surface actions are available.",
				action: "Use the actions command or renderer action view to inspect available operations.",
			};
		case REFARM_STATUS_DIAGNOSTICS.rendererNonInteractive:
			return {
				diagnostic,
				severity,
				summary: "The selected renderer is non-interactive.",
				action: "Use a web or TUI renderer when the workflow requires interactive controls.",
			};
		case REFARM_STATUS_DIAGNOSTICS.rendererNoRichHtml:
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
	.option("--next-action", "Print only the first blocking recovery action")
	.option("--next-command", "Print only the first executable recovery command")
	.option("--fail-on-warnings", "Treat warning diagnostics as failures")
	.addHelpText(
		"after",
		`

Examples:
  $ refarm doctor
  $ refarm doctor --json
  $ refarm doctor --next-action
  $ refarm doctor --next-action --json
  $ refarm doctor --next-command
  $ refarm doctor --fail-on-warnings
  $ refarm doctor --renderer web
  $ refarm doctor --input status.json

Notes:
  Doctor turns status diagnostics into operator recommendations.
  Use refarm check when you also want the repository health gate.
`,
	)
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
