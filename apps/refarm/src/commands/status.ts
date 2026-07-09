import { printJson } from "@refarm.dev/cli/json-output";
import {
	assertStatusJson,
	buildStatusJson,
	formatStatusSummary,
	parseStatusJson,
	type StatusJson,
} from "@refarm.dev/cli/status";
import { isHomesteadHostRendererKind } from "@refarm.dev/homestead/sdk/host-renderer";
import type { BaseSurfaceModel } from "@refarm.dev/operator-state";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { resolveRefarmRenderer } from "../renderers.js";
import { resolveTractorNamespace } from "../utils/tractor-store.js";
import { formatBaseSurfaceModel } from "./base-surface-output.js";
import { resolveBaseSurfaceStatus } from "./base-surface-status.js";
import { resolveRefarmHostIdentity } from "./runtime-metadata.js";
import { probeRuntimeLiveness } from "./runtime-readiness.js";
import {
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_STATUS_COMMAND,
} from "./runtime-recovery.js";
import {
	findRepoRoot,
	readTractorEngineModeAsync,
	resolveLaunchRuntime,
} from "./session-launch.js";
import { invokeStatusSurfaceActionSelection } from "./status-actions.js";
import { resolveJsonMarkdownStatusOutputMode } from "./status-output.js";
import { withResolvedStatusPayload } from "./status-payload.js";
import { runStatusPreflight } from "./status-preflight.js";
import { createStatusHostSurfaceState } from "./status-surfaces.js";

export interface ResolveStatusPayloadOptions {
	renderer?: string;
	input?: string;
}

export interface ResolveStatusPayloadResult {
	json: StatusJson;
	shutdown?: () => Promise<void>;
}

export interface StatusCommandDeps {
	resolveBaseSurfaceStatus?: () => Promise<BaseSurfaceModel>;
}

interface StatusCommandOptions {
	json?: boolean;
	markdown?: boolean;
	renderer?: string;
	input?: string;
	action?: string;
	base?: boolean;
}

async function createStatusRuntimeSummary(
	namespace: string,
): Promise<StatusJson["runtime"]> {
	const configuredEngine = await readTractorEngineModeAsync();
	const activeEngine = (() => {
		try {
			return resolveLaunchRuntime(findRepoRoot(), configuredEngine).activeEngine;
		} catch {
			return "unknown";
		}
	})();
	const probe = await probeRuntimeLiveness();
	return {
		ready: probe.ready,
		namespace,
		databaseName: namespace,
		...(probe.error ? { error: probe.error } : {}),
		engine: {
			configuredEngine,
			activeEngine,
		},
	};
}

function createStatusTrustSummary(): StatusJson["trust"] {
	return {
		profile: "strict",
		warnings: 0,
		critical: 0,
	};
}

export function printStatusSummary(json: StatusJson): void {
	console.log(formatStatusSummary(json));
}

export function createStatusCommand(deps: StatusCommandDeps = {}): Command {
	return new Command("status")
		.description("Report host status")
		.option(
			"--input <path>",
			"Read status payload from JSON file (or '-' for stdin) instead of booting runtime",
		)
		.option(
			"--renderer <kind>",
			"Renderer mode: web | tui | headless",
			"headless",
		)
		.option("--markdown", "Output markdown report")
		.option("--json", "Output machine-readable JSON")
		.option("--base", "Output the zero-extension daily-driver base state")
		.option(
			"--action <id-or-index>",
			"Invoke a live app-owned status action by available action ID or row index",
		)
		.addHelpText(
			"after",
			`

Examples:
  $ refarm status
  $ refarm status --json
  $ refarm status --markdown
  $ refarm status --base
  $ refarm status --base --json
  $ refarm status --renderer web
  $ refarm status --input status.json --markdown
  $ refarm status --action inspect-trust

Notes:
  Use ${RUNTIME_STATUS_COMMAND} for runtime engine/readiness details.
  Use ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND} for the shortest recovery step.
  Use ${RUNTIME_DOCTOR_NEXT_COMMAND} for command-only recovery automation.
  Use ${RUNTIME_DOCTOR_COMMAND} for the full readiness report.
`,
		)
		.action(async (options: StatusCommandOptions) => {
			if (options.base) {
				await emitBaseStatus(options, deps);
				return;
			}
			if (options.action) {
				if (options.json || options.markdown) {
					throw new Error(
						"--action cannot be combined with --json or --markdown.",
					);
				}
				if (options.input) {
					throw new Error(
						"--action cannot be combined with --input; use refarm actions --input <path> --select <id-or-index> for dry-run readiness.",
					);
				}

				await emitStatusActionInvocation(options);
				return;
			}

			const outputMode = resolveJsonMarkdownStatusOutputMode({
				json: options.json,
				markdown: options.markdown,
				defaultMode: "summary",
			});

			await runStatusPreflight({
				resolveStatusPayload,
				resolveOptions: options,
				outputMode,
				printSummary: printStatusSummary,
			});
		});
}

export const statusCommand = createStatusCommand();

async function emitBaseStatus(
	options: Pick<StatusCommandOptions, "json" | "markdown" | "input" | "action">,
	deps: StatusCommandDeps,
): Promise<void> {
	if (options.input) {
		throw new Error("--base cannot be combined with --input.");
	}
	if (options.action) {
		throw new Error("--base cannot be combined with --action.");
	}
	if (options.markdown) {
		throw new Error("--base cannot be combined with --markdown.");
	}
	const model = await (deps.resolveBaseSurfaceStatus ?? resolveBaseSurfaceStatus)();
	if (options.json) {
		printJson(model);
	} else {
		console.log(formatBaseSurfaceModel(model));
	}
	if (!model.ok) {
		process.exitCode = 1;
	}
}

async function emitStatusActionInvocation(options: {
	renderer?: string;
	input?: string;
	action?: string;
}): Promise<void> {
	await withResolvedStatusPayload({
		resolveStatusPayload,
		resolveOptions: options,
		run: async (json) => {
			const actionSelection = options.action;
			if (!actionSelection) {
				throw new Error("Missing --action action ID or row index.");
			}

			printJson(
				await invokeStatusSurfaceActionSelection({
					status: json,
					selection: actionSelection,
				}),
			);
		},
	});
}

export async function resolveStatusPayload(
	options: ResolveStatusPayloadOptions,
): Promise<ResolveStatusPayloadResult> {
	if (options.input) {
		return { json: readStatusPayloadFromInput(options.input) };
	}

	const requestedRenderer = options.renderer ?? "headless";
	if (!isHomesteadHostRendererKind(requestedRenderer)) {
		throw new Error(
			`Invalid renderer kind "${requestedRenderer}". Use one of: web, tui, headless.`,
		);
	}
	const renderer = resolveRefarmRenderer(requestedRenderer);
	// One source of truth (shared with health): the namespace the daemon actually
	// opens — REFARM_NAMESPACE ?? "default" — not the old brand.slug ?? "refarm-main"
	// guess, which named a db nothing ever created.
	const namespace = resolveTractorNamespace();
	const runtime = await createStatusRuntimeSummary(namespace);
	const trust = createStatusTrustSummary();
	const hostIdentity = resolveRefarmHostIdentity();

	const json = buildStatusJson({
		host: {
			app: hostIdentity.app,
			command: hostIdentity.command,
			profile: hostIdentity.profile,
			mode: renderer.kind,
		},
		renderer,
		runtime,
		trust,
		plugins: {
			surfaces: createStatusHostSurfaceState({
				hostId: hostIdentity.app,
				command: hostIdentity.command,
			}),
		},
	});
	assertStatusJson(json);

	return {
		json,
	};
}

export function readStatusPayloadFromInput(
	inputPath: string,
): StatusJson {
	const sourceLabel = inputPath === "-" ? "stdin" : inputPath;
	let raw: string;
	try {
		if (inputPath === "-") {
			raw = fs.readFileSync(0, "utf-8");
		} else {
			const resolvedPath = path.resolve(process.cwd(), inputPath);
			raw = fs.readFileSync(resolvedPath, "utf-8");
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read status input "${sourceLabel}": ${message}`);
	}

	try {
		return parseStatusJson(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to parse status input "${sourceLabel}": ${message}`,
		);
	}
}
