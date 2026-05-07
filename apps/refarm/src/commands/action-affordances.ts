import type {
	RefarmStatusJson,
	RefarmStatusSurfaceAction,
} from "@refarm.dev/cli/status";
import {
	formatExecutionPlanReadinessLine,
	type RefarmExecutionPlanReadinessLine,
} from "./execution-plan.js";

export interface RefarmActionAffordanceRow {
	index: number;
	id: string;
	label: string;
	intent?: string;
	display: string;
}

export type RefarmActionAffordanceSelectionReason =
	| "selected"
	| "missing-action"
	| "no-actions";

export type RefarmActionAffordanceSelectionSource = "id" | "index";

export interface RefarmActionAffordanceSelectionMetadata {
	requested: string;
	source: RefarmActionAffordanceSelectionSource;
	resolvedId?: string;
	index?: number;
}

export interface RefarmActionAffordanceSelectionResult {
	selected?: RefarmActionAffordanceRow;
	reason: RefarmActionAffordanceSelectionReason;
	selection: RefarmActionAffordanceSelectionMetadata;
	rows: readonly RefarmActionAffordanceRow[];
}

export interface RefarmActionReadinessDryRunEnvelope {
	schemaVersion: 1;
	statusSchemaVersion: RefarmStatusJson["schemaVersion"];
	reason: "dry-run";
	readiness: RefarmExecutionPlanReadinessLine;
	command?: string;
	renderer: string;
	selection?: RefarmActionAffordanceSelectionMetadata;
	selectedAction?: RefarmActionAffordanceRow;
	actionRows: readonly RefarmActionAffordanceRow[];
}

export interface RefarmActionReadinessDryRunEnvelopeOptions {
	renderer: string;
	command?: string;
	selection?: RefarmActionAffordanceSelectionResult;
}

export interface RefarmActionAffordanceSelectionFormatOptions {
	selectedHeading: string;
	availableHeading: string;
	selection?: RefarmActionAffordanceSelectionMetadata;
}

export interface RefarmActionReadinessOutputOptions<
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

export function getRefarmStatusAvailableActions(
	status: RefarmStatusJson,
): readonly RefarmStatusSurfaceAction[] {
	return status.plugins.availableActions ?? [];
}

export function createRefarmActionAffordanceRows(
	status: RefarmStatusJson,
): RefarmActionAffordanceRow[] {
	return getRefarmStatusAvailableActions(status).map((action, index) =>
		createRefarmActionAffordanceRow(action, index),
	);
}

export function resolveRefarmActionAffordanceSelection(
	status: RefarmStatusJson,
	selection: string,
): RefarmActionAffordanceSelectionResult {
	const rows = createRefarmActionAffordanceRows(status);
	const normalizedSelection = selection.trim();
	const selectionSource =
		getRefarmActionAffordanceSelectionSource(normalizedSelection);
	const selectionMetadata: RefarmActionAffordanceSelectionMetadata = {
		requested: normalizedSelection,
		source: selectionSource,
	};

	if (rows.length === 0) {
		return { reason: "no-actions", selection: selectionMetadata, rows };
	}

	const selectedByIndex = resolveRefarmActionAffordanceRowIndex(
		rows,
		normalizedSelection,
	);
	const selected =
		selectedByIndex ?? rows.find((row) => row.id === normalizedSelection);

	if (!selected) {
		return { reason: "missing-action", selection: selectionMetadata, rows };
	}

	return {
		reason: "selected",
		selected,
		selection: {
			...selectionMetadata,
			resolvedId: selected.id,
			index: selected.index,
		},
		rows,
	};
}

export function formatRefarmActionAffordanceRows(
	rows: readonly RefarmActionAffordanceRow[],
	heading = "Available actions:",
): string {
	if (rows.length === 0) return `${heading}\n  none`;
	return [heading, ...rows.map((row) => `  ${row.display}`)].join("\n");
}

export function createRefarmActionReadinessLine(
	status: RefarmStatusJson,
	selection?: RefarmActionAffordanceSelectionResult,
): RefarmExecutionPlanReadinessLine {
	const rows = selection?.rows ?? createRefarmActionAffordanceRows(status);
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

export function createRefarmActionReadinessDryRunEnvelope(
	status: RefarmStatusJson,
	options: RefarmActionReadinessDryRunEnvelopeOptions,
): RefarmActionReadinessDryRunEnvelope {
	return {
		schemaVersion: 1,
		statusSchemaVersion: status.schemaVersion,
		reason: "dry-run",
		readiness: createRefarmActionReadinessLine(status, options.selection),
		...(options.command ? { command: options.command } : {}),
		renderer: options.renderer,
		selection: options.selection?.selected
			? options.selection.selection
			: undefined,
		selectedAction: options.selection?.selected,
		actionRows:
			options.selection?.rows ?? createRefarmActionAffordanceRows(status),
	};
}

export function createRefarmRendererActionDryRunEnvelope<
	RendererKind extends string,
>(
	status: RefarmStatusJson,
	renderer: RendererKind,
	selection?: RefarmActionAffordanceSelectionResult,
	command?: string,
): RefarmActionReadinessDryRunEnvelope & {
	renderer: RendererKind;
	command?: string;
} {
	return createRefarmActionReadinessDryRunEnvelope(status, {
		renderer,
		selection,
		...(command ? { command } : {}),
	}) as RefarmActionReadinessDryRunEnvelope & {
		renderer: RendererKind;
		command?: string;
	};
}

export function formatRefarmActionReadinessOutput<
	RendererKind extends string,
>(status: RefarmStatusJson, options: RefarmActionReadinessOutputOptions<RendererKind>): string {
	if (options.select) {
		const selection = resolveRefarmActionAffordanceSelection(
			status,
			options.select,
		);
		if (!selection.selected) {
			if (options.json) {
				return JSON.stringify(
					createRefarmRendererActionDryRunEnvelope(
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
				`${options.unavailableSubject} "${options.select}" is not available. Available selections: ${formatRefarmActionSelectionChoices(selection.rows)}.`,
			);
		}

		if (options.json) {
			return JSON.stringify(
				createRefarmRendererActionDryRunEnvelope(
					status,
					options.renderer,
					selection,
					options.command,
				),
				null,
				2,
			);
		}

		return formatRefarmActionAffordanceSelection(
			selection.selected,
			selection.rows,
			{
				selectedHeading: options.selectedHeading,
				availableHeading: options.rowsHeading,
				selection: selection.selection,
			},
		);
	}

	const rows = createRefarmActionAffordanceRows(status);
	if (options.json) {
		return JSON.stringify(
			createRefarmRendererActionDryRunEnvelope(
				status,
				options.renderer,
				undefined,
				options.command,
			),
			null,
			2,
		);
	}

	return formatRefarmActionAffordanceRows(rows, options.rowsHeading);
}

export function formatRefarmActionAffordanceSelection(
	selected: RefarmActionAffordanceRow,
	rows: readonly RefarmActionAffordanceRow[],
	options: RefarmActionAffordanceSelectionFormatOptions,
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
		formatRefarmActionAffordanceRows(rows, options.availableHeading),
	].join("\n");
}

export function formatRefarmActionIds(
	actions: readonly { id: string }[],
): string {
	return actions.length > 0
		? actions.map((action) => action.id).join(", ")
		: "none";
}

export function formatRefarmActionSelectionChoices(
	rows: readonly { id: string; index?: number }[],
): string {
	if (rows.length === 0) return "none";
	return rows
		.map((row) =>
			typeof row.index === "number" ? `[${row.index}] ${row.id}` : row.id,
		)
		.join(", ");
}

function createRefarmActionAffordanceRow(
	action: RefarmStatusSurfaceAction,
	index: number,
): RefarmActionAffordanceRow {
	const rowIndex = index + 1;
	const intent = action.intent ? ` (${action.intent})` : "";
	return {
		index: rowIndex,
		id: action.id,
		label: action.label,
		intent: action.intent,
		display: `[${rowIndex}] ${action.label} — ${action.id}${intent}`,
	};
}

function getRefarmActionAffordanceSelectionSource(
	selection: string,
): RefarmActionAffordanceSelectionSource {
	return /^\d+$/.test(selection) ? "index" : "id";
}

function resolveRefarmActionAffordanceRowIndex(
	rows: readonly RefarmActionAffordanceRow[],
	selection: string,
): RefarmActionAffordanceRow | undefined {
	if (getRefarmActionAffordanceSelectionSource(selection) !== "index") {
		return undefined;
	}
	const index = Number.parseInt(selection, 10);
	return rows.find((row) => row.index === index);
}
