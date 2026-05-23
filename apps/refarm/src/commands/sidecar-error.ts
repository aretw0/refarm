import chalk from "chalk";
import {
	RUNTIME_AUTOSTART_ALWAYS_COMMAND,
	RUNTIME_DOCTOR_COMMAND,
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_ENGINE_AUTO_COMMAND,
	RUNTIME_START_COMMAND,
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
	console.error(chalk.dim(`   Diagnose:   ${RUNTIME_DOCTOR_COMMAND}`));
	console.error(chalk.dim(`   Autostart:  ${RUNTIME_AUTOSTART_ALWAYS_COMMAND}`));
	console.error(chalk.dim(`   Engine:     ${RUNTIME_ENGINE_AUTO_COMMAND}`));
}

export function printSidecarError(message: string): void {
	if (isSidecarUnavailable(message)) {
		printSidecarUnavailable();
		return;
	}
	console.error(chalk.red(`✗  ${message}`));
}

export function reportSidecarError(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	printSidecarError(message);
	process.exitCode = 1;
}
