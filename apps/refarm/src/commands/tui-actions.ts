import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import {
	createRefarmActionAffordanceRows,
	createRefarmActionReadinessDryRunEnvelope,
	formatRefarmActionAffordanceRows,
	formatRefarmActionAffordanceSelection,
	resolveRefarmActionAffordanceSelection,
	type RefarmActionAffordanceRow,
	type RefarmActionAffordanceSelectionMetadata,
	type RefarmActionAffordanceSelectionReason,
	type RefarmActionReadinessDryRunEnvelope,
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

export type TuiSurfaceActionDryRunEnvelope =
	RefarmActionReadinessDryRunEnvelope & {
		renderer: "tui";
	};

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

export function createTuiSurfaceActionDryRunEnvelope(
	status: RefarmStatusJson,
	selection?: TuiSurfaceActionSelectionResult,
): TuiSurfaceActionDryRunEnvelope {
	return createRefarmActionReadinessDryRunEnvelope(status, {
		renderer: "tui",
		selection,
	}) as TuiSurfaceActionDryRunEnvelope;
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
	return formatRefarmActionAffordanceSelection(selected, rows, {
		selectedHeading: "Selected TUI action:",
		availableHeading: "Available TUI actions:",
		selection,
	});
}
