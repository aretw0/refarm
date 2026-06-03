import {
	applicationCommand,
	applicationProcess,
	type ApplicationProcessSpec,
} from "@refarm.dev/cli/command-handoff";

export {
	applicationCommand,
	applicationProcess,
	binaryCommand,
	commandTemplateParameters,
	instantiateProcessTemplate,
	joinCommand,
	normalizeHandoffValues,
	quoteCommandArg,
	quoteCommandArgIfNeeded,
	shellCommand,
	substituteCommandTemplateValue,
	substituteCommandTemplateValues,
	workspaceCommand,
} from "@refarm.dev/cli/command-handoff";

export function refarmCommand(args: string[]): string {
	return applicationCommand("refarm", args);
}

export function refarmProcess(args: string[]): ApplicationProcessSpec {
	return applicationProcess("refarm", args);
}
