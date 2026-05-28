import { applicationCommand } from "@refarm.dev/cli/command-handoff";

export {
	applicationCommand,
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
