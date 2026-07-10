import {
	createRendererSurfaceActionDryRunEnvelope,
	createSurfaceActionAffordanceRows,
	formatSurfaceActionAffordanceRows,
	formatSurfaceActionAffordanceSelection,
	resolveSurfaceActionAffordanceSelection,
	type SurfaceActionAffordanceRow,
	type SurfaceActionAffordanceSelectionMetadata,
	type SurfaceActionAffordanceSelectionReason,
	type SurfaceActionReadinessDryRunEnvelope,
} from "@refarm.dev/cli/action-affordances";
import type { StatusJson } from "@refarm.dev/cli/status";

export type TuiSurfaceActionRow = SurfaceActionAffordanceRow;
export type TuiSurfaceActionSelectionReason = SurfaceActionAffordanceSelectionReason;

export interface TuiSurfaceActionSelectionResult {
	selected?: TuiSurfaceActionRow;
	reason: TuiSurfaceActionSelectionReason;
	selection: SurfaceActionAffordanceSelectionMetadata;
	rows: readonly TuiSurfaceActionRow[];
}

export type TuiSurfaceActionDryRunEnvelope = SurfaceActionReadinessDryRunEnvelope & {
	renderer: "tui";
};

export function createTuiSurfaceActionRows(status: StatusJson): TuiSurfaceActionRow[] {
	return createSurfaceActionAffordanceRows(status);
}

export function resolveTuiSurfaceActionSelection(
	status: StatusJson,
	selection: string,
): TuiSurfaceActionSelectionResult {
	return resolveSurfaceActionAffordanceSelection(status, selection);
}

export function createTuiSurfaceActionDryRunEnvelope(
	status: StatusJson,
	selection?: TuiSurfaceActionSelectionResult,
): TuiSurfaceActionDryRunEnvelope {
	return createRendererSurfaceActionDryRunEnvelope(
		status,
		"tui",
		selection,
	) as TuiSurfaceActionDryRunEnvelope;
}

export function formatTuiSurfaceActionRows(rows: readonly TuiSurfaceActionRow[]): string {
	return formatSurfaceActionAffordanceRows(rows, "Available TUI actions:");
}

export function formatTuiSurfaceActionSelection(
	selected: TuiSurfaceActionRow,
	rows: readonly TuiSurfaceActionRow[],
	selection?: SurfaceActionAffordanceSelectionMetadata,
): string {
	return formatSurfaceActionAffordanceSelection(selected, rows, {
		selectedHeading: "Selected TUI action:",
		availableHeading: "Available TUI actions:",
		selection,
	});
}
