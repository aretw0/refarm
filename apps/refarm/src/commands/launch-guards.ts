import { assertAtMostOneFlagEnabled } from "./option-guards.js";

export interface LaunchGuardOption {
	enabled?: boolean;
	flag: string;
}

export interface LaunchGuardInput {
	json?: boolean;
	markdown?: boolean;
	launch?: boolean;
	dryRun?: boolean;
	requiresLaunch?: LaunchGuardOption[];
}

export type LaunchGuardErrorCode =
	| "exclusive-output-format"
	| "launch-markdown"
	| "dry-run-requires-launch"
	| "launch-json-requires-dry-run"
	| "flag-requires-launch";

export interface LaunchGuardError {
	code: LaunchGuardErrorCode;
	message: string;
	flag?: string;
}

export function resolveLaunchGuardError(input: LaunchGuardInput): LaunchGuardError | null {
	const outputFlags = [
		{ enabled: input.json, flag: "--json" },
		{ enabled: input.markdown, flag: "--markdown" },
	].filter((flag) => flag.enabled);
	if (outputFlags.length > 1) {
		return {
			code: "exclusive-output-format",
			message: "Choose only one output format: --json or --markdown.",
		};
	}

	if (input.launch && input.markdown) {
		return {
			code: "launch-markdown",
			message: "--launch cannot be combined with --json or --markdown.",
		};
	}

	if (input.dryRun && !input.launch) {
		return {
			code: "dry-run-requires-launch",
			message: "--dry-run requires --launch.",
		};
	}

	if (input.launch && input.json && !input.dryRun) {
		return {
			code: "launch-json-requires-dry-run",
			message: "--launch --json requires --dry-run.",
		};
	}

	for (const requirement of input.requiresLaunch ?? []) {
		if (requirement.enabled && !input.launch) {
			return {
				code: "flag-requires-launch",
				message: `${requirement.flag} requires --launch.`,
				flag: requirement.flag,
			};
		}
	}

	return null;
}

export function assertLaunchGuardOptions(input: LaunchGuardInput): void {
	assertAtMostOneFlagEnabled(
		[
			{ enabled: input.json, flag: "--json" },
			{ enabled: input.markdown, flag: "--markdown" },
		],
		"Choose only one output format: --json or --markdown.",
	);

	const error = resolveLaunchGuardError(input);
	if (error) throw new Error(error.message);
}
