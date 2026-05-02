import {
	formatRefarmStatusJson,
	formatRefarmStatusMarkdown,
} from "@refarm.dev/cli/status";
import { Command } from "commander";
import { printStatusSummary, resolveStatusPayload } from "./status.js";

interface WebOptions {
	input?: string;
	json?: boolean;
	markdown?: boolean;
}

export const webCommand = new Command("web")
	.description("Report web renderer posture (launcher integration pending)")
	.option(
		"--input <path>",
		"Read status payload from JSON file (or '-' for stdin) instead of booting runtime",
	)
	.option("--json", "Output machine-readable JSON")
	.option("--markdown", "Output markdown report")
	.action(async (options: WebOptions) => {
		if (options.json && options.markdown) {
			throw new Error("Choose only one output format: --json or --markdown.");
		}

		const { json, shutdown } = await resolveStatusPayload({
			renderer: "web",
			input: options.input,
		});

		if (options.json) {
			console.log(formatRefarmStatusJson(json));
		} else if (options.markdown) {
			console.log(formatRefarmStatusMarkdown(json));
		} else {
			printStatusSummary(json);
			console.log(
				"Web launcher integration is pending; use this command as renderer preflight.",
			);
		}

		await shutdown?.();
	});
