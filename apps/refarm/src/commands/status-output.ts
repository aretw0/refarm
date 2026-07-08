import {
	formatStatusJson,
	formatStatusMarkdown,
	type StatusJson,
} from "@refarm.dev/cli/status";
import { assertAtMostOneFlagEnabled } from "./option-guards.js";

export type StatusOutputMode = "json" | "markdown" | "summary" | "silent";

export const STATUS_JSON_MARKDOWN_ERROR_MESSAGE =
	"Choose only one output format: --json or --markdown.";

export interface StatusOutputFlags {
	json?: boolean;
	markdown?: boolean;
	summary?: boolean;
}

export interface ResolveStatusOutputModeOptions {
	defaultMode: StatusOutputMode;
	errorMessage: string;
}

export function resolveStatusOutputMode(
	flags: StatusOutputFlags,
	options: ResolveStatusOutputModeOptions,
): StatusOutputMode {
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

export function resolveJsonMarkdownStatusOutputMode(options: {
	json?: boolean;
	markdown?: boolean;
	defaultMode: StatusOutputMode;
}): StatusOutputMode {
	return resolveStatusOutputMode(
		{ json: options.json, markdown: options.markdown },
		{
			defaultMode: options.defaultMode,
			errorMessage: STATUS_JSON_MARKDOWN_ERROR_MESSAGE,
		},
	);
}

export function emitStatusOutput(options: {
	status: StatusJson;
	mode: StatusOutputMode;
	printSummary: (json: StatusJson) => void;
}): void {
	if (options.mode === "silent") {
		return;
	}

	if (options.mode === "json") {
		console.log(formatStatusJson(options.status));
		return;
	}

	if (options.mode === "markdown") {
		console.log(formatStatusMarkdown(options.status));
		return;
	}

	options.printSummary(options.status);
}
