import {
	applicationCommand,
	applicationProcess,
	type ApplicationProcessSpec,
} from "@refarm.dev/cli/command-handoff";

export {
	applicationCommand,
	applicationProcess,
	binaryCommand,
	joinCommand,
	normalizeHandoffValues,
	quoteCommandArg,
	quoteCommandArgIfNeeded,
	shellCommand,
	workspaceCommand,
} from "@refarm.dev/cli/command-handoff";

export function refarmCommand(args: string[]): string {
	return applicationCommand("refarm", args);
}

export function refarmProcess(args: string[]): ApplicationProcessSpec {
	return applicationProcess("refarm", args);
}
