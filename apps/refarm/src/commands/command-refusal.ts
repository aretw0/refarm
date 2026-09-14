import { buildJsonErrorEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import chalk from "chalk";

interface RefusalOptions {
	json?: boolean;
}

export interface CommandRefusalInput {
	command: string;
	operation: string;
	options: RefusalOptions;
	error: string;
	message: string;
	nextAction?: string;
	nextCommands?: string[];
	humanHints?: string[];
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.trim().length > 0) return value;
	}
	return undefined;
}

export function emitCommandRefusal(input: CommandRefusalInput): void {
	const nextCommands = (input.nextCommands ?? []).filter(
		(command): command is string => command.trim().length > 0,
	);
	const nextAction =
		firstNonEmpty([input.nextAction, nextCommands[0], "Inspect diagnostics."]) ??
		"Inspect diagnostics.";

	if (input.options.json) {
		printJson(
			buildJsonErrorEnvelope({
				command: input.command,
				operation: input.operation,
				error: input.error,
				message: input.message,
				nextAction,
				...(nextCommands.length > 0 ? { nextCommands } : {}),
			}),
		);
		process.exitCode = 1;
		return;
	}

	console.error(chalk.red(`✗  ${input.message}`));
	if (input.humanHints && input.humanHints.length > 0) {
		for (const hint of input.humanHints) console.error(chalk.dim(`   ${hint}`));
	} else {
		for (const command of nextCommands) console.error(chalk.dim(`   ${command}`));
	}
	process.exitCode = 1;
}