import {
	classifyStatusDiagnostics,
	STATUS_DIAGNOSTICS,
	type StatusJson,
} from "@refarm.dev/cli/status";
import fs from "node:fs";
import path from "node:path";

import { declaredBase, loadConfig, sovereignDir } from "@refarm.dev/config";

import { Command } from "commander";
import { readNodeDescriptor } from "../utils/node-descriptor.js";
import { resolveRefarmHome } from "../utils/refarm-home.js";
import { buildConnectionDoctorRecommendations } from "./connection-doctor.js";
import {
	diagnosticNextActions,
	diagnosticNextCommands,
	type DiagnosticRecommendation,
	type DiagnosticRecommendationSeverity,
} from "./diagnostic-recommendations.js";
import { emitRefarmDoctorOutput, resolveDoctorOutputMode } from "./doctor-output.js";
import { resolveRefarmRuntimeMetadata, type RefarmRuntimeMetadata } from "./runtime-metadata.js";
import {
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_NOT_READY_RECOVERY_ACTION,
	RUNTIME_STATUS_COMMAND,
} from "./runtime-recovery.js";
import { buildScopeDoctorRecommendations, type ScopeComparison } from "./scope-doctor.js";
import { withResolvedStatusPayload } from "./status-payload.js";
import { resolveStatusPayload } from "./status.js";

export interface RefarmDoctorReport {
	command: "doctor";
	operation: "diagnose";
	ok: boolean;
	failureCount: number;
	warningCount: number;
	failures: string[];
	warnings: string[];
	informational: string[];
	recommendations: RefarmDoctorRecommendation[];
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
	host: RefarmRuntimeMetadata;
	status: StatusJson;
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
	status: StatusJson,
	options: {
		failOnWarnings?: boolean;
		metadata?: RefarmRuntimeMetadata;
		/** The config object `loadConfig()` returns — read ONLY for the declared
		 * `connections` block (see `connection-doctor.ts`). Omitted (the default) means
		 * "nothing declared", which produces no connection findings — this keeps the
		 * function pure and every caller that does not pass it (including every existing
		 * test) unaffected. */
		connectionConfig?: Record<string, unknown>;
		/** Where the operator is standing beside where the node lives (see
		 * `scope-doctor.ts`). Omitted means "not compared", which produces no findings —
		 * same purity rule as `connectionConfig`, and every existing caller is unaffected. */
		scope?: { comparison: ScopeComparison; exists: (filePath: string) => boolean };
	} = {},
): RefarmDoctorReport {
	const { failures, warnings: statusWarnings, informational } = classifyStatusDiagnostics(status);
	// A declared connection with an unresolvable binary, or a catalog issue, is a doctor
	// finding in its own right (Task 3) — folded into the SAME `warnings`/`recommendations`
	// buckets status diagnostics use rather than a parallel mechanism, so the existing
	// output/JSON/next-action plumbing (doctor-output.ts) surfaces it for free.
	const connectionRecommendations = buildConnectionDoctorRecommendations(
		options.connectionConfig ?? {},
	);
	// The node answering from one directory while the operator edits another is the same
	// KIND of thing: a truth nothing else states, folded into the same buckets.
	const scopeRecommendations = options.scope
		? buildScopeDoctorRecommendations(options.scope.comparison, options.scope.exists)
		: [];
	const warnings = [
		...statusWarnings,
		...connectionRecommendations.map((r) => r.diagnostic),
		...scopeRecommendations.map((r) => r.diagnostic),
	];

	const failOnWarnings = options.failOnWarnings === true;
	const ok = failures.length === 0 && (!failOnWarnings || warnings.length === 0);
	const recommendations = [
		...buildRefarmDoctorRecommendations({
			failures,
			warnings: statusWarnings,
			informational,
		}),
		...connectionRecommendations,
		...scopeRecommendations,
	];
	const nextActions = diagnosticNextActions(recommendations);
	const nextCommands = diagnosticNextCommands(recommendations);

	return {
		command: "doctor",
		operation: "diagnose",
		ok,
		failureCount: failures.length,
		warningCount: warnings.length,
		failures,
		warnings,
		informational,
		recommendations,
		nextAction: nextActions[0] ?? null,
		nextActions,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
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
		case STATUS_DIAGNOSTICS.runtimeNotReady:
			return {
				diagnostic,
				severity,
				summary: "The runtime reported that it is not ready.",
				action: RUNTIME_NOT_READY_RECOVERY_ACTION,
				command: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
			};
		case STATUS_DIAGNOSTICS.runtimeSidecarAccessBlocked:
			return {
				diagnostic,
				severity,
				summary: "The runtime sidecar could not be reached from this execution surface.",
				action:
					"Run the runtime status probe from a direct shell or approved command surface with local sidecar network access.",
				command: `${RUNTIME_STATUS_COMMAND} --json`,
			};
		case STATUS_DIAGNOSTICS.trustCriticalPresent:
			return {
				diagnostic,
				severity,
				summary: "Critical trust diagnostics are present.",
				action:
					"Review trust policy and rejected capabilities before launching interactive surfaces.",
			};
		case STATUS_DIAGNOSTICS.trustWarningsPresent:
			return {
				diagnostic,
				severity,
				summary: "Trust warnings are present.",
				action: "Inspect trust warnings and decide whether they should block this workflow.",
			};
		case STATUS_DIAGNOSTICS.pluginsRejectedSurfacesPresent:
			return {
				diagnostic,
				severity,
				summary: "One or more plugin surfaces were rejected.",
				action: "Inspect plugin manifests and host surface policy before exposing plugin UI.",
			};
		case STATUS_DIAGNOSTICS.streamsActivePresent:
			return {
				diagnostic,
				severity,
				summary: "Runtime streams are still active.",
				action: "Wait for active streams to finish, or inspect stream telemetry before shutdown.",
			};
		case STATUS_DIAGNOSTICS.pluginsSurfaceActionsAvailable:
			return {
				diagnostic,
				severity,
				summary: "Plugin surface actions are available.",
				action: "Use the actions command or renderer action view to inspect available operations.",
			};
		case STATUS_DIAGNOSTICS.rendererNonInteractive:
			return {
				diagnostic,
				severity,
				summary: "The selected renderer is non-interactive.",
				action: "Use a web or TUI renderer when the workflow requires interactive controls.",
			};
		case STATUS_DIAGNOSTICS.rendererNoRichHtml:
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

export interface RefarmDoctorCommandDeps {
	/** Overrides for resolving the config `buildConnectionDoctorRecommendations` reads
	 * (Task 3). Both default to the real `process.cwd()` / `loadConfig()` — injected so
	 * tests can drive the connection-finding wiring without ever touching the real
	 * `.refarm/config.json`. */
	cwd?: () => string;
	loadConfig?: (root?: string) => Record<string, unknown>;
	/** What the running node says about itself — injected so a test can state "a node is
	 *  running and answers from there" without one. */
	readNodeDescriptor?: (refarmHome: string) => { declarationBase: string; sovereignDir: string } | null;
}

/**
 * Resolve the config object connection findings are read from. Never throws: a broken
 * `.refarm/config.json` is a different failure surface — `refarm connection status`
 * already surfaces a load failure explicitly with a JSON error envelope — so doctor
 * must not crash the WHOLE report over it. It just has nothing to check for connection
 * findings this run, same "report, never fail shut" posture as `readConnectionCatalog`.
 */
/**
 * Where the operator is standing, beside where a node started with this home would look.
 *
 * Resolved here rather than inside the finding so `scope-doctor.ts` stays pure and every
 * test drives it with literals. Never throws: a scope comparison is a courtesy, and a
 * doctor that crashes because a path could not be resolved is worse than one that stays
 * quiet about it.
 */
function resolveScopeComparison(
	deps: RefarmDoctorCommandDeps | undefined,
): { comparison: ScopeComparison; exists: (filePath: string) => boolean } | undefined {
	try {
		const operatorBase = path.resolve(deps?.cwd?.() ?? declaredBase());
		const nodeHome = path.resolve(resolveRefarmHome());
		// What the RUNNING node says about itself, when it is running and says it. Absent,
		// stale or unreadable falls back to this home — the same inference as before, which
		// is right whenever the node was started with the home it lives in, and only wrong
		// in the case the descriptor exists to catch.
		const running = deps?.readNodeDescriptor?.(nodeHome) ?? readNodeDescriptor(nodeHome);
		const dir = running?.sovereignDir ?? sovereignDir();
		// `resolveRefarmHome()` IS the sovereign dir; a descriptor's `declarationBase` is its
		// PARENT, because that is what the config path convention joins the dir name onto.
		// Naming the final directory once keeps the two from being confused.
		const nodeDir = running ? path.join(path.resolve(running.declarationBase), dir) : nodeHome;
		return {
			comparison: {
				operatorConfigPath: path.join(operatorBase, dir, "config.json"),
				nodeConfigPath: path.join(nodeDir, "config.json"),
				operatorPolicyPath: path.join(operatorBase, dir, "auth-policy.json"),
				nodePolicyPath: path.join(nodeDir, "auth-policy.json"),
			},
			exists: (filePath) => fs.existsSync(filePath),
		};
	} catch {
		return undefined;
	}
}

function resolveConnectionConfig(deps: RefarmDoctorCommandDeps | undefined): Record<string, unknown> {
	const baseDir = deps?.cwd?.() ?? process.cwd();
	try {
		return (deps?.loadConfig ?? loadConfig)(baseDir) as Record<string, unknown>;
	} catch {
		return {};
	}
}

export function createDoctorCommand(deps?: RefarmDoctorCommandDeps): Command {
	return new Command("doctor")
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
						connectionConfig: resolveConnectionConfig(deps),
						scope: resolveScopeComparison(deps),
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
}

export const doctorCommand = createDoctorCommand();
