import {
	formatRefarmStatusJson,
	formatRefarmStatusMarkdown,
	type RefarmStatusJson,
} from "@refarm.dev/cli/status";
import { Command } from "commander";
import {
	printStatusSummary,
	type ResolveStatusPayloadResult,
	resolveStatusPayload,
} from "./status.js";

interface TuiOptions {
	input?: string;
	json?: boolean;
	markdown?: boolean;
}

interface TuiDeps {
	resolveStatusPayload(options: {
		renderer: string;
		input?: string;
	}): Promise<ResolveStatusPayloadResult>;
	printStatusSummary(json: RefarmStatusJson): void;
}

export function createTuiCommand(deps?: Partial<TuiDeps>): Command {
	const resolvedDeps: TuiDeps = {
		resolveStatusPayload,
		printStatusSummary,
		...deps,
	};

	return new Command("tui")
		.description("Report TUI renderer posture (launcher integration pending)")
		.option(
			"--input <path>",
			"Read status payload from JSON file (or '-' for stdin) instead of booting runtime",
		)
		.option("--json", "Output machine-readable JSON")
		.option("--markdown", "Output markdown report")
		.action(async (options: TuiOptions) => {
			if (options.json && options.markdown) {
				throw new Error("Choose only one output format: --json or --markdown.");
			}

			const { json, shutdown } = await resolvedDeps.resolveStatusPayload({
				renderer: "tui",
				input: options.input,
			});

			if (options.json) {
				console.log(formatRefarmStatusJson(json));
			} else if (options.markdown) {
				console.log(formatRefarmStatusMarkdown(json));
			} else {
				resolvedDeps.printStatusSummary(json);
				console.log(
					"TUI launcher integration is pending; use this command as renderer preflight.",
				);
			}

			await shutdown?.();
		});
}

export const tuiCommand = createTuiCommand();
