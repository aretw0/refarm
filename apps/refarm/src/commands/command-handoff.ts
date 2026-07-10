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
} from "@refarm.dev/cli/command-handoff";

// `refarmCommand` / `refarmProcess` moved to `../brand.ts` (ADR-087 — only the app
// owns its brand). Re-exported here so the deprecated shim keeps resolving them.
export { refarmCommand, refarmProcess } from "../brand.js";
