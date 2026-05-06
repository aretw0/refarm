import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import { Command } from "commander";
import {
	createRefarmActionAffordanceRows,
	formatRefarmActionAffordanceRows,
	formatRefarmActionIds,
	resolveRefarmActionAffordanceSelection,
	type RefarmActionAffordanceRow,
	type RefarmActionAffordanceSelectionMetadata,
	type RefarmActionAffordanceSelectionReason,
} from "./action-affordances.js";
import { withResolvedStatusPayload } from "./status-payload.js";
import {
	resolveStatusPayload,
	type ResolveStatusPayloadResult,
} from "./status.js";

export type HostSurfaceActionRow = RefarmActionAffordanceRow;
export type HostSurfaceActionSelectionReason =
	RefarmActionAffordanceSelectionReason;

export interface HostSurfaceActionSelectionResult {
	selected?: HostSurfaceActionRow;
	reason: HostSurfaceActionSelectionReason;
	selection: RefarmActionAffordanceSelectionMetadata;
	rows: readonly HostSurfaceActionRow[];
}

export interface HostSurfaceActionDryRunEnvelope {
	schemaVersion: 1;
	statusSchemaVersion: RefarmStatusJson["schemaVersion"];
	reason: "dry-run";
	command: "actions";
	renderer: RefarmStatusJson["renderer"]["kind"];
	selection?: RefarmActionAffordanceSelectionMetadata;
	selectedAction?: HostSurfaceActionRow;
	actionRows: readonly HostSurfaceActionRow[];
}

export interface ActionsDeps {
	resolveStatusPayload(options: {
		renderer?: string;
		input?: string;
	}): Promise<ResolveStatusPayloadResult>;
}

interface ActionsOptions {
	input?: string;
	renderer?: string;
	json?: boolean;
	select?: string;
}

export function createHostSurfaceActionRows(
	status: RefarmStatusJson,
): HostSurfaceActionRow[] {
	return createRefarmActionAffordanceRows(status);
}

export function resolveHostSurfaceActionSelection(
	status: RefarmStatusJson,
	selection: string,
): HostSurfaceActionSelectionResult {
	return resolveRefarmActionAffordanceSelection(status, selection);
}

export function createHostSurfaceActionDryRunEnvelope(
	status: RefarmStatusJson,
	selection?: HostSurfaceActionSelectionResult,
): HostSurfaceActionDryRunEnvelope {
	return {
		schemaVersion: 1,
		statusSchemaVersion: status.schemaVersion,
		reason: "dry-run",
		command: "actions",
		renderer: status.renderer.kind,
		selection: selection?.selected ? selection.selection : undefined,
		selectedAction: selection?.selected,
		actionRows: selection?.rows ?? createHostSurfaceActionRows(status),
	};
}

export function formatHostSurfaceActionRows(
	rows: readonly HostSurfaceActionRow[],
): string {
	return formatRefarmActionAffordanceRows(rows, "Available host actions:");
}

export function formatHostSurfaceActionSelection(
	selected: HostSurfaceActionRow,
	rows: readonly HostSurfaceActionRow[],
	selection?: RefarmActionAffordanceSelectionMetadata,
): string {
	const selectionLines = selection
		? [
				"Selection:",
				`  requested: ${selection.requested}`,
				`  resolved: ${selection.resolvedId ?? selected.id}`,
				`  source: ${selection.source}`,
			]
		: [];

	return [
		"Selected host action:",
		`  ${selected.display}`,
		...selectionLines,
		formatHostSurfaceActionRows(rows),
	].join("\n");
}

export function createActionsCommand(deps?: Partial<ActionsDeps>): Command {
	const resolvedDeps: ActionsDeps = {
		resolveStatusPayload,
		...deps,
	};

	return new Command("actions")
		.description(
			"List available host surface actions without executing product behavior",
		)
		.option(
			"--input <path>",
			"Read status payload from JSON file (or '-' for stdin) instead of booting runtime",
		)
		.option(
			"--renderer <kind>",
			"Renderer mode used to resolve status context: web | tui | headless",
			"headless",
		)
		.option("--json", "Output machine-readable dry-run envelope")
		.option(
			"--select <id-or-index>",
			"Select an available host action ID or row index without executing it",
		)
		.action(async (options: ActionsOptions) => {
			await emitHostActionRows(options, resolvedDeps);
		});
}

async function emitHostActionRows(
	options: ActionsOptions,
	deps: ActionsDeps,
): Promise<void> {
	await withResolvedStatusPayload({
		resolveStatusPayload: deps.resolveStatusPayload,
		resolveOptions: {
			renderer: options.renderer,
			input: options.input,
		},
		run: (json) => {
			if (options.select) {
				const selection = resolveHostSurfaceActionSelection(
					json,
					options.select,
				);
				if (!selection.selected) {
					throw new Error(
						`Host action "${options.select}" is not available. Available actions: ${formatRefarmActionIds(selection.rows)}.`,
					);
				}

				if (options.json) {
					console.log(
						JSON.stringify(
							createHostSurfaceActionDryRunEnvelope(json, selection),
							null,
							2,
						),
					);
					return;
				}

				console.log(
					formatHostSurfaceActionSelection(
						selection.selected,
						selection.rows,
						selection.selection,
					),
				);
				return;
			}

			const rows = createHostSurfaceActionRows(json);
			if (options.json) {
				console.log(
					JSON.stringify(createHostSurfaceActionDryRunEnvelope(json), null, 2),
				);
				return;
			}

			console.log(formatHostSurfaceActionRows(rows));
		},
	});
}

export const actionsCommand = createActionsCommand();
