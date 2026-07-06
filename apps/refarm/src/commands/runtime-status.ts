import {
	type RuntimeSidecarProbeSummary,
	type RuntimeStatusSummary,
} from "@refarm.dev/runtime";
import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";

import { resolveRuntimeSidecarUrl } from "../utils/runtime-config.js";
import {
	LOCAL_MODEL_JSON_COMMAND,
	MODEL_CURRENT_JSON_COMMAND,
	MODEL_PROVIDERS_JSON_COMMAND,
	OPERATOR_LINKS_CONFIG_COMMAND,
	RESUME_JSON_COMMAND,
	SOW_INTERACTIVE_COMMAND,
	SOW_JSON_COMMAND,
} from "./credential-handoffs.js";
import {
	resolveRuntimeLaunchCommand,
	type RuntimeLaunchCommand,
} from "./runtime-launcher.js";
import type { RuntimeReadinessProbe } from "./runtime-readiness.js";
import {
	RUNTIME_AUTOSTART_ALWAYS_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENGINE_AUTO_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_START_COMMAND,
	RUNTIME_START_DRY_RUN_JSON_COMMAND,
	RUNTIME_STATUS_COMMAND,
} from "./runtime-recovery.js";
import type { RuntimeCommandDeps } from "./runtime.js";

/**
 * The status/diagnostics engine for `refarm runtime` — extracted verbatim from
 * runtime.ts. Builds the runtime status payload (engine/readiness/sidecar), its
 * JSON envelope + next-command/next-action handoffs, startup-log diagnostics and
 * their recovery recommendations, and the human status renderer. References
 * `RuntimeCommandDeps` via a type-only import from runtime.ts (erased at compile,
 * so no runtime cycle).
 */

export type RuntimeStatusPayload = RuntimeStatusSummary;

const START_LOG_TAIL_LINES = 40;

export interface RuntimeStartDiagnostics {
	logPath?: string;
	logTail?: string[];
}

export interface RuntimeDiagnosticRecovery {
	nextCommands?: string[];
	recommendations?: {
		diagnostic: string;
		severity: "failure" | "warning" | "info";
		summary: string;
		action: string;
		command?: string;
	}[];
	handoffs?: {
		interactive: string;
		inspectCurrent: string;
		inspectProviders: string;
		localNoKeyModel: string;
		openExternalLinks: string;
	};
}

export type RuntimeJsonPayload<TExtra extends object = object> =
	RuntimeStatusPayload &
		TExtra & {
			command: "runtime";
			operation: "status" | "ensure" | "start" | "restart";
			ok: boolean;
			nextAction: string | null;
			nextActions: string[];
			nextCommand: string | null;
			nextCommands: string[];
		};

function runtimeSidecarProbeSummary(
	probe: RuntimeReadinessProbe,
): RuntimeSidecarProbeSummary {
	return {
		url: probe.url,
		ready: probe.ready,
		...(probe.status !== undefined ? { status: probe.status } : {}),
		...(probe.error ? { error: probe.error } : {}),
		...(probe.timedOut ? { timedOut: true } : {}),
	};
}

export async function runtimeStatusPayload(
	deps: RuntimeCommandDeps,
): Promise<RuntimeStatusPayload> {
	const configuredEngine = await deps.readEngine();
	const autostart = await deps.readAutostart();
	const sidecar = deps.readSidecarUrl?.() ?? resolveRuntimeSidecarUrl();
	const repoRoot = deps.repoRoot();
	const readinessProbe = deps.probeReadiness ? await deps.probeReadiness() : undefined;
	const ready = readinessProbe?.ready ?? (deps.probeReady ? await deps.probeReady() : undefined);
	const sidecarProbe = readinessProbe
		? runtimeSidecarProbeSummary(readinessProbe)
		: undefined;
	try {
		const selection = deps.resolveRuntime(repoRoot, configuredEngine);
		return {
			configuredEngine,
			activeEngine: selection.activeEngine,
			autostart,
			reason: selection.reason,
			sidecarUrl: sidecar.value,
			sidecarUrlSource: sidecar.source,
			...(sidecarProbe ? { sidecarProbe } : {}),
			ready,
			startCommand: resolveRuntimeLaunchCommand(
				repoRoot,
				selection.activeEngine,
			).display,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			configuredEngine,
			activeEngine: "unknown",
			autostart,
			reason: "configured-rust-missing-binary",
			sidecarUrl: sidecar.value,
			sidecarUrlSource: sidecar.source,
			...(sidecarProbe ? { sidecarProbe } : {}),
			ready,
			issue: message,
		};
	}
}

function runtimeNextCommands(payload: RuntimeStatusPayload): string[] {
	if (payload.activeEngine === "unknown") {
		return [
			RUNTIME_ENGINE_AUTO_COMMAND,
			RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
			RUNTIME_DOCTOR_NEXT_COMMAND,
		];
	}
	if (payload.ready === false) {
		return [RUNTIME_ENSURE_WAIT_NEXT_COMMAND, RUNTIME_DOCTOR_NEXT_COMMAND];
	}
	if (payload.ready === true) {
		return [RESUME_JSON_COMMAND];
	}
	return [];
}

export function buildRuntimeJsonPayload<TExtra extends object = object>(
	payload: RuntimeStatusPayload,
	extra?: TExtra,
	nextCommandsOverride?: string[],
	operation: RuntimeJsonPayload["operation"] = "status",
): RuntimeJsonPayload<TExtra> {
	const nextCommands = nextCommandsOverride ?? runtimeNextCommands(payload);
	const nextActions = runtimeNextActions(nextCommands, extra);
	return {
		command: "runtime",
		operation,
		...payload,
		...(extra ?? {}),
		ok: runtimePayloadOk(payload),
		nextAction: nextActions[0] ?? null,
		nextActions,
		nextCommand: nextCommands[0] ?? null,
		nextCommands,
	} as RuntimeJsonPayload<TExtra>;
}

function runtimePayloadOk(payload: RuntimeStatusPayload): boolean {
	return payload.activeEngine !== "unknown" && !payload.issue && payload.ready !== false;
}

function runtimeNextActions<TExtra extends object = object>(
	nextCommands: string[],
	extra?: TExtra,
): string[] {
	const recommendationAction = firstRecommendationAction(extra);
	return recommendationAction
		? [recommendationAction]
		: nextCommands.length > 0
			? [nextCommands[0]!]
			: [];
}

function firstRecommendationAction(extra?: object): string | null {
	if (!extra || typeof extra !== "object") return null;
	const recommendations = (extra as { recommendations?: unknown }).recommendations;
	if (!Array.isArray(recommendations)) return null;
	for (const recommendation of recommendations) {
		if (!recommendation || typeof recommendation !== "object") continue;
		const action = (recommendation as { action?: unknown }).action;
		if (typeof action === "string" && action.trim().length > 0) {
			return action.trim();
		}
	}
	return null;
}

export function runtimeStartDiagnostics(
	command?: RuntimeLaunchCommand,
): RuntimeStartDiagnostics | undefined {
	if (!command?.logPath) return undefined;
	if (!existsSync(command.logPath)) return { logPath: command.logPath };
	const content = readFileSync(command.logPath, "utf-8");
	const logTail = content
		.split(/\r?\n/)
		.filter((line) => line.trim().length > 0)
		.slice(-START_LOG_TAIL_LINES);
	return {
		logPath: command.logPath,
		...(logTail.length > 0 ? { logTail } : {}),
	};
}

export function runtimeStartDiagnosticRecovery(
	diagnostics?: RuntimeStartDiagnostics,
): RuntimeDiagnosticRecovery {
	const logText = diagnostics?.logTail?.join("\n") ?? "";
	if (
		logText.includes("API_KEY is not set") ||
		logText.includes("Configure keys with: refarm sow")
	) {
		return {
			nextCommands: [
				SOW_INTERACTIVE_COMMAND,
				MODEL_CURRENT_JSON_COMMAND,
				MODEL_PROVIDERS_JSON_COMMAND,
				SOW_JSON_COMMAND,
				LOCAL_MODEL_JSON_COMMAND,
				OPERATOR_LINKS_CONFIG_COMMAND,
			],
			recommendations: [
				{
					diagnostic: "model-credentials-missing",
					severity: "failure",
					summary: "The runtime startup log reports missing model credentials.",
					action: "Inspect credential handoffs and configure a usable model route.",
					command: SOW_INTERACTIVE_COMMAND,
				},
			],
			handoffs: {
				interactive: SOW_INTERACTIVE_COMMAND,
				inspectCurrent: MODEL_CURRENT_JSON_COMMAND,
				inspectProviders: MODEL_PROVIDERS_JSON_COMMAND,
				localNoKeyModel: LOCAL_MODEL_JSON_COMMAND,
				openExternalLinks: OPERATOR_LINKS_CONFIG_COMMAND,
			},
		};
	}
	if (diagnostics?.logPath) {
		return {
			nextCommands: [
				RUNTIME_START_DRY_RUN_JSON_COMMAND,
				RUNTIME_STATUS_COMMAND,
				RUNTIME_DOCTOR_NEXT_COMMAND,
			],
			recommendations: [
				{
					diagnostic: "runtime-start-no-readiness",
					severity: "failure",
					summary: "The runtime was started but did not become ready, and the startup log has no actionable output.",
					action: "Inspect the resolved runtime launch command before retrying readiness recovery.",
					command: RUNTIME_START_DRY_RUN_JSON_COMMAND,
				},
			],
		};
	}
	return {};
}

export function printRuntimeStatus(payload: RuntimeStatusPayload): void {
	console.log(chalk.bold("Refarm runtime"));
	console.log(`  configured: ${payload.configuredEngine}`);
	console.log(`  active:     ${payload.activeEngine}`);
	const readyLabel =
		payload.ready === undefined ? "unknown" : payload.ready ? "yes" : "no";
	console.log(`  ready:      ${readyLabel}`);
	console.log(`  autostart:  ${payload.autostart}`);
	if (payload.sidecarUrl) {
		console.log(`  sidecar:    ${payload.sidecarUrl}`);
	}
	console.log(`  reason:     ${payload.reason}`);
	if (payload.startCommand) {
		console.log(`  start:      ${payload.startCommand}`);
	}
	if (payload.issue) {
		console.log(chalk.yellow(`  issue:      ${payload.issue}`));
	}
	console.log("");
	console.log(chalk.dim(`  Select engine:  ${RUNTIME_ENGINE_AUTO_COMMAND}`));
	console.log(chalk.dim(`  Start runtime:  ${RUNTIME_START_COMMAND}`));
	console.log(chalk.dim(`  Autostart:      ${RUNTIME_AUTOSTART_ALWAYS_COMMAND}`));
	console.log(chalk.dim("  Full status:    refarm status --json"));
}

export async function resolveRuntimeStartCommand(deps: RuntimeCommandDeps): Promise<{
	payload: RuntimeStatusPayload;
	command?: RuntimeLaunchCommand;
}> {
	const repoRoot = deps.repoRoot();
	const payload = await runtimeStatusPayload(deps);
	if (payload.activeEngine === "unknown") {
		return { payload };
	}
	return {
		payload,
		command: resolveRuntimeLaunchCommand(repoRoot, payload.activeEngine),
	};
}
