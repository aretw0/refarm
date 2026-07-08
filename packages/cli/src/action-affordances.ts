import {
	createBaseSurfaceActionRows,
	formatBaseSurfaceActionRows,
	formatBaseSurfaceActionSelectionChoices,
	resolveBaseSurfaceActionSelection,
	type BaseSurfaceActionRow,
	type BaseSurfaceActionSelectionMetadata,
	type BaseSurfaceActionSelectionReason,
	type BaseSurfaceActionSelectionResult,
	type BaseSurfaceActionSelectionSource,
} from "@refarm.dev/operator-state";

import {
	formatExecutionPlanReadinessLine,
	type ExecutionPlanReadinessLine,
} from "./execution-plan.js";
import type {
	RefarmStatusJson,
	RefarmStatusSurfaceAction,
} from "./status.js";

export type SurfaceActionAffordanceRow = BaseSurfaceActionRow;
export type SurfaceActionAffordanceSelectionReason =
	BaseSurfaceActionSelectionReason;
export type SurfaceActionAffordanceSelectionSource =
	BaseSurfaceActionSelectionSource;
export type SurfaceActionAffordanceSelectionMetadata =
	BaseSurfaceActionSelectionMetadata;
export type SurfaceActionAffordanceSelectionResult =
	BaseSurfaceActionSelectionResult;

export interface SurfaceActionReadinessDryRunEnvelope {
	schemaVersion: 1;
	statusSchemaVersion: RefarmStatusJson["schemaVersion"];
	reason: "dry-run";
	readiness: ExecutionPlanReadinessLine;
	command?: string;
	renderer: string;
	selection?: SurfaceActionAffordanceSelectionMetadata;
	selectedAction?: SurfaceActionAffordanceRow;
	actionRows: readonly SurfaceActionAffordanceRow[];
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
}

export interface SurfaceActionReadinessDryRunEnvelopeOptions {
	renderer: string;
	command?: string;
	selection?: SurfaceActionAffordanceSelectionResult;
}

export interface SurfaceActionAffordanceSelectionFormatOptions {
	selectedHeading: string;
	availableHeading: string;
	selection?: SurfaceActionAffordanceSelectionMetadata;
}

export interface SurfaceActionReadinessOutputOptions<
	RendererKind extends string,
> {
	renderer: RendererKind;
	command?: string;
	json?: boolean;
	select?: string;
	unavailableSubject: string;
	rowsHeading: string;
	selectedHeading: string;
}

export function getStatusAvailableSurfaceActions(
	status: RefarmStatusJson,
): readonly RefarmStatusSurfaceAction[] {
	return status.plugins.availableActions ?? [];
}

export function createSurfaceActionAffordanceRows(
	status: RefarmStatusJson,
): SurfaceActionAffordanceRow[] {
	return createBaseSurfaceActionRows(getStatusAvailableSurfaceActions(status));
}

export function resolveSurfaceActionAffordanceSelection(
	status: RefarmStatusJson,
	selection: string,
): SurfaceActionAffordanceSelectionResult {
	const rows = createSurfaceActionAffordanceRows(status);
	return resolveBaseSurfaceActionSelection(rows, selection);
}

export function formatSurfaceActionAffordanceRows(
	rows: readonly SurfaceActionAffordanceRow[],
	heading = "Available actions:",
): string {
	return formatBaseSurfaceActionRows(rows, heading);
}

export function createSurfaceActionReadinessLine(
	status: RefarmStatusJson,
	selection?: SurfaceActionAffordanceSelectionResult,
): ExecutionPlanReadinessLine {
	const rows = selection?.rows ?? createSurfaceActionAffordanceRows(status);
	if (selection?.reason === "missing-action") {
		return formatExecutionPlanReadinessLine({
			readyToExecute: false,
			blockedReason: `host action "${selection.selection.requested}" is not available`,
		});
	}
	if (selection?.reason === "no-actions" || rows.length === 0) {
		return formatExecutionPlanReadinessLine({
			readyToExecute: false,
			blockedReason: "no host actions available",
		});
	}
	return formatExecutionPlanReadinessLine({ readyToExecute: true });
}

export function createSurfaceActionReadinessDryRunEnvelope(
	status: RefarmStatusJson,
	options: SurfaceActionReadinessDryRunEnvelopeOptions,
): SurfaceActionReadinessDryRunEnvelope {
	return {
		schemaVersion: 1,
		statusSchemaVersion: status.schemaVersion,
		reason: "dry-run",
		readiness: createSurfaceActionReadinessLine(status, options.selection),
		...(options.command ? { command: options.command } : {}),
		renderer: options.renderer,
		selection: options.selection?.selected
			? options.selection.selection
			: undefined,
		selectedAction: options.selection?.selected,
		actionRows:
			options.selection?.rows ?? createSurfaceActionAffordanceRows(status),
		nextAction: null,
		nextActions: [],
		nextCommand: null,
		nextCommands: [],
	};
}

export function createRendererSurfaceActionDryRunEnvelope<
	RendererKind extends string,
>(
	status: RefarmStatusJson,
	renderer: RendererKind,
	selection?: SurfaceActionAffordanceSelectionResult,
	command?: string,
): SurfaceActionReadinessDryRunEnvelope & {
	renderer: RendererKind;
	command?: string;
} {
	return createSurfaceActionReadinessDryRunEnvelope(status, {
		renderer,
		selection,
		...(command ? { command } : {}),
	}) as SurfaceActionReadinessDryRunEnvelope & {
		renderer: RendererKind;
		command?: string;
	};
}

export function formatSurfaceActionReadinessOutput<
	RendererKind extends string,
>(
	status: RefarmStatusJson,
	options: SurfaceActionReadinessOutputOptions<RendererKind>,
): string {
	if (options.select) {
		const selection = resolveSurfaceActionAffordanceSelection(
			status,
			options.select,
		);
		if (!selection.selected) {
			if (options.json) {
				return JSON.stringify(
					createRendererSurfaceActionDryRunEnvelope(
						status,
						options.renderer,
						selection,
						options.command,
					),
					null,
					2,
				);
			}
			throw new Error(
				`${options.unavailableSubject} "${options.select}" is not available. Available selections: ${formatSurfaceActionSelectionChoices(selection.rows)}.`,
			);
		}

		if (options.json) {
			return JSON.stringify(
				createRendererSurfaceActionDryRunEnvelope(
					status,
					options.renderer,
					selection,
					options.command,
				),
				null,
				2,
			);
		}

		return formatSurfaceActionAffordanceSelection(
			selection.selected,
			selection.rows,
			{
				selectedHeading: options.selectedHeading,
				availableHeading: options.rowsHeading,
				selection: selection.selection,
			},
		);
	}

	const rows = createSurfaceActionAffordanceRows(status);
	if (options.json) {
		return JSON.stringify(
			createRendererSurfaceActionDryRunEnvelope(
				status,
				options.renderer,
				undefined,
				options.command,
			),
			null,
			2,
		);
	}

	return formatSurfaceActionAffordanceRows(rows, options.rowsHeading);
}

export function formatSurfaceActionAffordanceSelection(
	selected: SurfaceActionAffordanceRow,
	rows: readonly SurfaceActionAffordanceRow[],
	options: SurfaceActionAffordanceSelectionFormatOptions,
): string {
	const selectionLines = options.selection
		? [
				"Selection:",
				`  requested: ${options.selection.requested}`,
				`  resolved: ${options.selection.resolvedId ?? selected.id}`,
				`  source: ${options.selection.source}`,
			]
		: [];

	return [
		options.selectedHeading,
		`  ${selected.display}`,
		...selectionLines,
		formatSurfaceActionAffordanceRows(rows, options.availableHeading),
	].join("\n");
}

export function formatSurfaceActionIds(
	actions: readonly { id: string }[],
): string {
	return actions.length > 0
		? actions.map((action) => action.id).join(", ")
		: "none";
}

export function formatSurfaceActionSelectionChoices(
	rows: readonly { id: string; index?: number }[],
): string {
	return formatBaseSurfaceActionSelectionChoices(rows);
}

export type RefarmActionAffordanceRow = SurfaceActionAffordanceRow;
export type RefarmActionAffordanceSelectionReason =
	SurfaceActionAffordanceSelectionReason;
export type RefarmActionAffordanceSelectionSource =
	SurfaceActionAffordanceSelectionSource;
export type RefarmActionAffordanceSelectionMetadata =
	SurfaceActionAffordanceSelectionMetadata;
export type RefarmActionAffordanceSelectionResult =
	SurfaceActionAffordanceSelectionResult;
export type RefarmActionReadinessDryRunEnvelope =
	SurfaceActionReadinessDryRunEnvelope;
export type RefarmActionReadinessDryRunEnvelopeOptions =
	SurfaceActionReadinessDryRunEnvelopeOptions;
export type RefarmActionAffordanceSelectionFormatOptions =
	SurfaceActionAffordanceSelectionFormatOptions;
export type RefarmActionReadinessOutputOptions<
	RendererKind extends string,
> = SurfaceActionReadinessOutputOptions<RendererKind>;

export const getRefarmStatusAvailableActions =
	getStatusAvailableSurfaceActions;
export const createRefarmActionAffordanceRows =
	createSurfaceActionAffordanceRows;
export const resolveRefarmActionAffordanceSelection =
	resolveSurfaceActionAffordanceSelection;
export const formatRefarmActionAffordanceRows =
	formatSurfaceActionAffordanceRows;
export const createRefarmActionReadinessLine =
	createSurfaceActionReadinessLine;
export const createRefarmActionReadinessDryRunEnvelope =
	createSurfaceActionReadinessDryRunEnvelope;
export const createRefarmRendererActionDryRunEnvelope =
	createRendererSurfaceActionDryRunEnvelope;
export const formatRefarmActionReadinessOutput =
	formatSurfaceActionReadinessOutput;
export const formatRefarmActionAffordanceSelection =
	formatSurfaceActionAffordanceSelection;
export const formatRefarmActionIds = formatSurfaceActionIds;
export const formatRefarmActionSelectionChoices =
	formatSurfaceActionSelectionChoices;
