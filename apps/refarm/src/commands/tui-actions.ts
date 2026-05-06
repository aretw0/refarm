import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import {
	createRefarmActionAffordanceRows,
	formatRefarmActionAffordanceRows,
	resolveRefarmActionAffordanceSelection,
	type RefarmActionAffordanceRow,
	type RefarmActionAffordanceSelectionReason,
} from "./action-affordances.js";

export type TuiSurfaceActionRow = RefarmActionAffordanceRow;
export type TuiSurfaceActionSelectionReason =
	RefarmActionAffordanceSelectionReason;

export interface TuiSurfaceActionSelectionResult {
	selected?: TuiSurfaceActionRow;
	reason: TuiSurfaceActionSelectionReason;
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
): string {
	return [
		"Selected TUI action:",
		`  ${selected.display}`,
		formatTuiSurfaceActionRows(rows),
	].join("\n");
}
