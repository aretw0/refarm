import {
	formatRefarmStatusJson,
	formatRefarmStatusMarkdown,
} from "@refarm.dev/cli/status";
import { Command } from "commander";
import { assertAtMostOneFlagEnabled } from "./option-guards.js";
import { printStatusSummary, resolveStatusPayload } from "./status.js";

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
		assertAtMostOneFlagEnabled(
			[
				{ enabled: options.markdown, flag: "--markdown" },
				{ enabled: options.summary, flag: "--summary" },
			],
			"Choose only one output format: --markdown or --summary.",
		);

		const { json, shutdown } = await resolveStatusPayload({
			renderer: "headless",
			input: options.input,
		});

		if (options.markdown) {
			console.log(formatRefarmStatusMarkdown(json));
		} else if (options.summary) {
			printStatusSummary(json);
		} else {
			console.log(formatRefarmStatusJson(json));
		}

		await shutdown?.();
	});
