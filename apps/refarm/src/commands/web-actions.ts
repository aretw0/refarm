import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import {
	createRefarmActionAffordanceRows,
	formatRefarmActionAffordanceRows,
	resolveRefarmActionAffordanceSelection,
	type RefarmActionAffordanceRow,
	type RefarmActionAffordanceSelectionMetadata,
	type RefarmActionAffordanceSelectionReason,
} from "./action-affordances.js";

export type WebSurfaceActionRow = RefarmActionAffordanceRow;
export type WebSurfaceActionSelectionReason =
	RefarmActionAffordanceSelectionReason;

export interface WebSurfaceActionSelectionResult {
	selected?: WebSurfaceActionRow;
	reason: WebSurfaceActionSelectionReason;
	selection: RefarmActionAffordanceSelectionMetadata;
	rows: readonly WebSurfaceActionRow[];
}

export interface WebSurfaceActionDryRunEnvelope {
	schemaVersion: 1;
	statusSchemaVersion: RefarmStatusJson["schemaVersion"];
	reason: "dry-run";
	renderer: "web";
	selection?: RefarmActionAffordanceSelectionMetadata;
	selectedAction?: WebSurfaceActionRow;
	actionRows: readonly WebSurfaceActionRow[];
}

export function createWebSurfaceActionRows(
	status: RefarmStatusJson,
): WebSurfaceActionRow[] {
	return createRefarmActionAffordanceRows(status);
}

export function resolveWebSurfaceActionSelection(
	status: RefarmStatusJson,
	selection: string,
): WebSurfaceActionSelectionResult {
	return resolveRefarmActionAffordanceSelection(status, selection);
}

export function createWebSurfaceActionDryRunEnvelope(
	status: RefarmStatusJson,
	selection?: WebSurfaceActionSelectionResult,
): WebSurfaceActionDryRunEnvelope {
	return {
		schemaVersion: 1,
		statusSchemaVersion: status.schemaVersion,
		reason: "dry-run",
		renderer: "web",
		selection: selection?.selected ? selection.selection : undefined,
		selectedAction: selection?.selected,
		actionRows: selection?.rows ?? createWebSurfaceActionRows(status),
	};
}

export function formatWebSurfaceActionRows(
	rows: readonly WebSurfaceActionRow[],
): string {
	return formatRefarmActionAffordanceRows(rows, "Available Web actions:");
}

export function formatWebSurfaceActionSelection(
	selected: WebSurfaceActionRow,
	rows: readonly WebSurfaceActionRow[],
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
		"Selected Web action:",
		`  ${selected.display}`,
		...selectionLines,
		formatWebSurfaceActionRows(rows),
	].join("\n");
}
