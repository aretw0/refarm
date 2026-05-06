import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import {
	createRefarmActionAffordanceRows,
	formatRefarmActionAffordanceRows,
	resolveRefarmActionAffordanceSelection,
	type RefarmActionAffordanceRow,
	type RefarmActionAffordanceSelectionMetadata,
	type RefarmActionAffordanceSelectionReason,
} from "./action-affordances.js";

export type TuiSurfaceActionRow = RefarmActionAffordanceRow;
export type TuiSurfaceActionSelectionReason =
	RefarmActionAffordanceSelectionReason;

export interface TuiSurfaceActionSelectionResult {
	selected?: TuiSurfaceActionRow;
	reason: TuiSurfaceActionSelectionReason;
	selection: RefarmActionAffordanceSelectionMetadata;
	rows: readonly TuiSurfaceActionRow[];
}

export function createTuiSurfaceActionRows(
	status: RefarmStatusJson,
): TuiSurfaceActionRow[] {
	return createRefarmActionAffordanceRows(status);
}

export function resolveTuiSurfaceActionSelection(
	status: RefarmStatusJson,
	selection: string,
): TuiSurfaceActionSelectionResult {
	return resolveRefarmActionAffordanceSelection(status, selection);
}

export function formatTuiSurfaceActionRows(
	rows: readonly TuiSurfaceActionRow[],
): string {
	return formatRefarmActionAffordanceRows(rows, "Available TUI actions:");
}

export function formatTuiSurfaceActionSelection(
	selected: TuiSurfaceActionRow,
	rows: readonly TuiSurfaceActionRow[],
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
		"Selected TUI action:",
		`  ${selected.display}`,
		...selectionLines,
		formatTuiSurfaceActionRows(rows),
	].join("\n");
}
