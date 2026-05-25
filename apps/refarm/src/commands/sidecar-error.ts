import chalk from "chalk";
import { buildJsonErrorEnvelope, printJson } from "./json-output.js";
import {
	RUNTIME_AUTOSTART_ALWAYS_COMMAND,
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_ENGINE_AUTO_COMMAND,
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
	RUNTIME_START_COMMAND,
	RUNTIME_START_WAIT_COMMAND,
	RUNTIME_STATUS_COMMAND,
} from "./runtime-recovery.js";

export function isSidecarUnavailable(message: string): boolean {
	return (
		message.includes("ECONNREFUSED") ||
		message.includes("fetch failed") ||
		message.includes("Runtime HTTP") ||
		message.includes("Farmhand HTTP")
	);
}

export function printSidecarUnavailable(): void {
	console.error(chalk.red("✗  Refarm runtime is not running."));
	console.error(chalk.dim(`   Status:     ${RUNTIME_STATUS_COMMAND}`));
	console.error(chalk.dim(`   Start now:  ${RUNTIME_START_COMMAND}`));
	console.error(chalk.dim(`   Next:       ${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND}`));
	console.error(chalk.dim(`   Command:    ${RUNTIME_DOCTOR_NEXT_COMMAND}`));
	console.error(chalk.dim(`   Diagnose:   ${RUNTIME_DOCTOR_COMMAND}`));
	console.error(chalk.dim(`   Autostart:  ${RUNTIME_AUTOSTART_ALWAYS_COMMAND}`));
	console.error(chalk.dim(`   Engine:     ${RUNTIME_ENGINE_AUTO_COMMAND}`));
}

export function buildSidecarErrorPayload(
	message: string,
	context: { command?: string; operation?: string } = {},
) {
	if (isSidecarUnavailable(message)) {
		return buildJsonErrorEnvelope({
			...context,
			error: "runtime-unavailable",
			message: "Refarm runtime is not running.",
			nextAction: RUNTIME_START_COMMAND,
			nextActions: [
				RUNTIME_STATUS_COMMAND,
				RUNTIME_START_COMMAND,
				RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
				RUNTIME_DOCTOR_COMMAND,
				RUNTIME_AUTOSTART_ALWAYS_COMMAND,
				RUNTIME_ENGINE_AUTO_COMMAND,
			],
			nextCommand: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
			nextCommands: [
				RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
				RUNTIME_START_WAIT_COMMAND,
				RUNTIME_DOCTOR_NEXT_COMMAND,
			],
			extra: {
				recommendations: [
					{
						diagnostic: "runtime:unavailable",
						severity: "failure",
						summary: "The local runtime sidecar is not reachable.",
						action: "Ensure the selected runtime is running and inspect the next recovery command.",
						command: RUNTIME_ENSURE_WAIT_NEXT_COMMAND,
					},
				],
			},
		});
	}
	return buildJsonErrorEnvelope({
		...context,
		error: "runtime-request-failed",
		message,
		nextAction: RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
		nextActions: [RUNTIME_DOCTOR_NEXT_ACTION_COMMAND, RUNTIME_DOCTOR_COMMAND],
		nextCommand: RUNTIME_DOCTOR_NEXT_COMMAND,
		nextCommands: [RUNTIME_DOCTOR_NEXT_COMMAND],
		extra: {
			recommendations: [
				{
					diagnostic: "runtime:request-failed",
					severity: "failure",
					summary: "A request to the local runtime failed.",
					action: "Run doctor to inspect runtime readiness and policy diagnostics.",
					command: RUNTIME_DOCTOR_NEXT_COMMAND,
				},
			],
		},
	});
}

export function printSidecarError(message: string): void {
	if (isSidecarUnavailable(message)) {
		printSidecarUnavailable();
		return;
	}
	console.error(chalk.red(`✗  ${message}`));
}

export function reportSidecarError(
	error: unknown,
	options: { json?: boolean; command?: string; operation?: string } = {},
): void {
	const message = error instanceof Error ? error.message : String(error);
	if (options.json) {
		printJson(
			buildSidecarErrorPayload(message, {
				command: options.command,
				operation: options.operation,
			}),
		);
		process.exitCode = 1;
		return;
	}
	printSidecarError(message);
	process.exitCode = 1;
}
