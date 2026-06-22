import {
	applicationCommand,
	applicationProcess,
	type ApplicationProcessSpec,
} from "@refarm.dev/cli/command-handoff";

export type { ApplicationProcessSpec };

export function refarmCommand(args: string[]): string {
	return applicationCommand("refarm", args);
}

export function refarmProcess(args: string[]): ApplicationProcessSpec {
	return applicationProcess("refarm", args);
}
