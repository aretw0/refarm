import {
	formatRefarmStatusJson,
	formatRefarmStatusMarkdown,
	type RefarmStatusJson,
} from "@refarm.dev/cli/status";
import { assertAtMostOneFlagEnabled } from "./option-guards.js";

export type RefarmStatusOutputMode = "json" | "markdown" | "summary";

export interface RefarmStatusOutputFlags {
	json?: boolean;
	markdown?: boolean;
	summary?: boolean;
}

export interface ResolveStatusOutputModeOptions {
	defaultMode: RefarmStatusOutputMode;
	errorMessage: string;
}

export function resolveStatusOutputMode(
	flags: RefarmStatusOutputFlags,
	options: ResolveStatusOutputModeOptions,
): RefarmStatusOutputMode {
	assertAtMostOneFlagEnabled(
		[
			{ enabled: flags.json, flag: "--json" },
			{ enabled: flags.markdown, flag: "--markdown" },
			{ enabled: flags.summary, flag: "--summary" },
		],
		options.errorMessage,
	);

	if (flags.json) {
		return "json";
	}
	if (flags.markdown) {
		return "markdown";
	}
	if (flags.summary) {
		return "summary";
	}
	return options.defaultMode;
}

export function emitRefarmStatusOutput(options: {
	status: RefarmStatusJson;
	mode: RefarmStatusOutputMode;
	printSummary: (json: RefarmStatusJson) => void;
}): void {
	if (options.mode === "json") {
		console.log(formatRefarmStatusJson(options.status));
		return;
	}

	if (options.mode === "markdown") {
		console.log(formatRefarmStatusMarkdown(options.status));
		return;
	}

	options.printSummary(options.status);
}
