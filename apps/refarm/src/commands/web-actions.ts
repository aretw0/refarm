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

export type WebSurfaceActionRow = RefarmActionAffordanceRow;
export type WebSurfaceActionSelectionReason =
	RefarmActionAffordanceSelectionReason;

export interface WebSurfaceActionSelectionResult {
	selected?: WebSurfaceActionRow;
	reason: WebSurfaceActionSelectionReason;
	selection: RefarmActionAffordanceSelectionMetadata;
	rows: readonly WebSurfaceActionRow[];
}

export type WebSurfaceActionDryRunEnvelope =
	RefarmActionReadinessDryRunEnvelope & {
		renderer: "web";
	};

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
	return createRefarmActionReadinessDryRunEnvelope(status, {
		renderer: "web",
		selection,
	}) as WebSurfaceActionDryRunEnvelope;
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
	return formatRefarmActionAffordanceSelection(selected, rows, {
		selectedHeading: "Selected Web action:",
		availableHeading: "Available Web actions:",
		selection,
	});
}
