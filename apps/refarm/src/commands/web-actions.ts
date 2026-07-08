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

export type WebSurfaceActionRow = SurfaceActionAffordanceRow;
export type WebSurfaceActionSelectionReason =
	SurfaceActionAffordanceSelectionReason;

export interface WebSurfaceActionSelectionResult {
	selected?: WebSurfaceActionRow;
	reason: WebSurfaceActionSelectionReason;
	selection: SurfaceActionAffordanceSelectionMetadata;
	rows: readonly WebSurfaceActionRow[];
}

export type WebSurfaceActionDryRunEnvelope =
	SurfaceActionReadinessDryRunEnvelope & {
		renderer: "web";
	};

export function createWebSurfaceActionRows(
	status: StatusJson,
): WebSurfaceActionRow[] {
	return createSurfaceActionAffordanceRows(status);
}

export function resolveWebSurfaceActionSelection(
	status: StatusJson,
	selection: string,
): WebSurfaceActionSelectionResult {
	return resolveSurfaceActionAffordanceSelection(status, selection);
}

export function createWebSurfaceActionDryRunEnvelope(
	status: StatusJson,
	selection?: WebSurfaceActionSelectionResult,
): WebSurfaceActionDryRunEnvelope {
	return createRendererSurfaceActionDryRunEnvelope(
		status,
		"web",
		selection,
	) as WebSurfaceActionDryRunEnvelope;
}

export function formatWebSurfaceActionRows(
	rows: readonly WebSurfaceActionRow[],
): string {
	return formatSurfaceActionAffordanceRows(rows, "Available Web actions:");
}

export function formatWebSurfaceActionSelection(
	selected: WebSurfaceActionRow,
	rows: readonly WebSurfaceActionRow[],
	selection?: SurfaceActionAffordanceSelectionMetadata,
): string {
	return formatSurfaceActionAffordanceSelection(selected, rows, {
		selectedHeading: "Selected Web action:",
		availableHeading: "Available Web actions:",
		selection,
	});
}
