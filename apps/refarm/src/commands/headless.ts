import { Command } from "commander";
import { withResolvedStatusPayload } from "./status-payload.js";
import { printStatusSummary, resolveStatusPayload } from "./status.js";
import {
	emitRefarmStatusOutput,
	resolveStatusOutputMode,
} from "./status-output.js";

interface HeadlessOptions {
	input?: string;
	markdown?: boolean;
	summary?: boolean;
}

export const headlessCommand = new Command("headless")
	.description(
		"Emit a machine-readable host snapshot in headless renderer mode",
	)
	.option(
		"--input <path>",
		"Read status payload from JSON file (or '-' for stdin) instead of booting runtime",
	)
	.option("--markdown", "Output markdown report")
	.option("--summary", "Output human-readable status summary")
	.action(async (options: HeadlessOptions) => {
		const outputMode = resolveStatusOutputMode(
			{ markdown: options.markdown, summary: options.summary },
			{
				defaultMode: "json",
				errorMessage: "Choose only one output format: --markdown or --summary.",
			},
		);

		await withResolvedStatusPayload({
			resolveStatusPayload,
			resolveOptions: {
				renderer: "headless",
				input: options.input,
			},
			run: (json) => {
				emitRefarmStatusOutput({
					status: json,
					mode: outputMode,
					printSummary: printStatusSummary,
				});
			},
		});
	});
