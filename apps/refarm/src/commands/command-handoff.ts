import {
	type ApplicationProcessSpec
} from "@refarm.dev/cli/command-handoff";

export type { ApplicationProcessSpec };

// Deprecated compatibility shim. Prefer importing directly from @refarm.dev/cli/command-handoff.
export {
	applicationCommand,
	applicationProcess,
	binaryCommand,
	commandTemplateParameters,
	instantiateCommandTemplate,
	instantiateCommandTemplateById,
	instantiateProcessTemplate,
	joinCommand,
	normalizeHandoffValues,
	quoteCommandArg,
	quoteCommandArgIfNeeded,
	shellCommand,
	substituteCommandTemplateValue,
	substituteCommandTemplateValues,
	workspaceCommand,
	refarmCommand,
	refarmProcess,
} from "@refarm.dev/cli/command-handoff";
