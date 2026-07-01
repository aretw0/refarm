/**
 * Compatibility shim.
 *
 * @deprecated Prefer importing from `@refarm.dev/cli/command-handoff` directly.
 */
import {
	type ApplicationProcessSpec,
} from "@refarm.dev/cli/command-handoff";

/**
 * Compatibility shim.
 *
 * @deprecated Prefer importing from `@refarm.dev/cli/command-handoff` directly.
 */
export type { ApplicationProcessSpec };

/**
 * Compatibility shim.
 *
 * @deprecated Prefer importing from `@refarm.dev/cli/command-handoff` directly.
 */
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
