import chalk from "chalk";

export function isSidecarUnavailable(message: string): boolean {
	return message.includes("ECONNREFUSED") || message.includes("fetch failed");
}

export function printSidecarUnavailable(): void {
	console.error(chalk.red("✗  Refarm runtime is not running."));
	console.error(chalk.dim("   Start now:  refarm"));
	console.error(chalk.dim("   Diagnose:   refarm doctor"));
	console.error(chalk.dim("   Always:     refarm config set runtime.autostart always"));
	console.error(chalk.dim("   Engine:     refarm config set tractor.engine auto"));
}

export function printSidecarError(message: string): void {
	if (isSidecarUnavailable(message)) {
		printSidecarUnavailable();
		return;
	}
	console.error(chalk.red(`✗  ${message}`));
}

export function exitForSidecarError(error: unknown): never {
	const message = error instanceof Error ? error.message : String(error);
	printSidecarError(message);
	process.exit(1);
}
