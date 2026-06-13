import { Command } from "commander";
import {
	formatSurfaceActionSelectionChoices,
	resolveSurfaceActionAffordanceSelection,
} from "./action-affordances.js";
import {
	createHeadlessStatusSurfaceActionBlockedDryRunEnvelope,
	createHeadlessStatusSurfaceActionDryRunEnvelope,
	resolveHeadlessStatusSurfaceActionRequest,
} from "./headless-action.js";
import { printJson } from "./json-output.js";
import { resolveStatusOutputMode } from "./status-output.js";
import { withResolvedStatusPayload } from "./status-payload.js";
import { runStatusPreflight } from "./status-preflight.js";
import { printStatusSummary, resolveStatusPayload } from "./status.js";

interface HeadlessOptions {
	input?: string;
	markdown?: boolean;
	summary?: boolean;
	actionRequest?: string;
}

export const headlessCommand = new Command("headless")
	.description(
		"Emit a machine-readable host snapshot in headless renderer mode",
	)
	.addHelpText(
		"after",
		[
			"",
			"Examples:",
			"  $ refarm headless",
			"  $ refarm headless --summary",
			"  $ refarm headless --markdown",
			"  $ refarm headless --action-request <id-or-index>",
			"",
			"Notes:",
			"  Default output is JSON for automation.",
			"  --action-request emits a dry-run action envelope; it does not open browsers or mutate state.",
			"  Use refarm actions, refarm web --actions, or refarm tui --actions to inspect available IDs.",
		].join("\n"),
	)
	.option(
		"--input <path>",
		"Read status payload from JSON file (or '-' for stdin) instead of booting runtime",
	)
	.option("--markdown", "Output markdown report")
	.option("--summary", "Output human-readable status summary")
	.option(
		"--action-request <id-or-index>",
		"Output a dry-run Homestead action request envelope for an available action ID or row index",
	)
	.action(async (options: HeadlessOptions) => {
		if (options.actionRequest) {
			if (options.markdown || options.summary) {
				throw new Error(
					"Choose only one output format: --action-request, --markdown, or --summary.",
				);
			}

			await emitHeadlessActionRequest(options);
			return;
		}

		const outputMode = resolveStatusOutputMode(
			{ markdown: options.markdown, summary: options.summary },
			{
				defaultMode: "json",
				errorMessage: "Choose only one output format: --markdown or --summary.",
			},
		);

		await runStatusPreflight({
			resolveStatusPayload,
			resolveOptions: {
				renderer: "headless",
				input: options.input,
			},
			outputMode,
			printSummary: printStatusSummary,
		});
	});

async function emitHeadlessActionRequest(
	options: HeadlessOptions,
): Promise<void> {
	await withResolvedStatusPayload({
		resolveStatusPayload,
		resolveOptions: {
			renderer: "headless",
			input: options.input,
		},
		run: (json) => {
			const actionSelection = options.actionRequest;
			if (!actionSelection) {
				throw new Error("Missing --action-request action ID or row index.");
			}

			const selectedAction = resolveSurfaceActionAffordanceSelection(
				json,
				actionSelection,
			);

			if (!selectedAction.selected) {
				printJson(
					createHeadlessStatusSurfaceActionBlockedDryRunEnvelope(
						json,
						selectedAction.reason === "no-actions"
							? "no host actions available"
							: `host action "${selectedAction.selection.requested}" is not available`,
						selectedAction.rows,
					),
				);
				return;
			}

			const resolution = resolveHeadlessStatusSurfaceActionRequest({
				status: json,
				actionId: selectedAction.selected.id,
			});

			if (!resolution.request) {
				throw new Error(
					`Action "${selectedAction.selected.id}" is not available. Available selections: ${formatSurfaceActionSelectionChoices(selectedAction.rows)}.`,
				);
			}

			printJson(
				createHeadlessStatusSurfaceActionDryRunEnvelope(
					json,
					selectedAction.selection,
					resolution.request,
					resolution.availableActions,
				),
			);
		},
	});
}
