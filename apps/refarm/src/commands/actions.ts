import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import { Command } from "commander";
import {
	createRefarmActionAffordanceRows,
	createRefarmRendererActionDryRunEnvelope,
	formatRefarmActionReadinessOutput,
	formatRefarmActionAffordanceRows,
	formatRefarmActionAffordanceSelection,
	resolveRefarmActionAffordanceSelection,
	type RefarmActionAffordanceRow,
	type RefarmActionAffordanceSelectionMetadata,
	type RefarmActionAffordanceSelectionReason,
	type RefarmActionReadinessDryRunEnvelope,
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

export type HostSurfaceActionDryRunEnvelope =
	RefarmActionReadinessDryRunEnvelope & {
		command: "actions";
		renderer: RefarmStatusJson["renderer"]["kind"];
	};

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
	return createRefarmRendererActionDryRunEnvelope(
		status,
		status.renderer.kind,
		selection,
		"actions",
	) as HostSurfaceActionDryRunEnvelope;
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
	return formatRefarmActionAffordanceSelection(selected, rows, {
		selectedHeading: "Selected host action:",
		availableHeading: "Available host actions:",
		selection,
	});
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
			console.log(
				formatRefarmActionReadinessOutput(json, {
					renderer: json.renderer.kind,
					command: "actions",
					json: options.json,
					select: options.select,
					unavailableSubject: "Host action",
					rowsHeading: "Available host actions:",
					selectedHeading: "Selected host action:",
				}),
			);
		},
	});
}

export const actionsCommand = createActionsCommand();
