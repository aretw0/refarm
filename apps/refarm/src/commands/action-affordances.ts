import type {
	RefarmStatusJson,
	RefarmStatusSurfaceAction,
} from "@refarm.dev/cli/status";

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

export interface RefarmActionAffordanceSelectionResult {
	selected?: RefarmActionAffordanceRow;
	reason: RefarmActionAffordanceSelectionReason;
	rows: readonly RefarmActionAffordanceRow[];
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
	if (rows.length === 0) return { reason: "no-actions", rows };

	const normalizedSelection = selection.trim();
	const selectedByIndex = resolveRefarmActionAffordanceRowIndex(
		rows,
		normalizedSelection,
	);
	const selected =
		selectedByIndex ?? rows.find((row) => row.id === normalizedSelection);

	return selected
		? { reason: "selected", selected, rows }
		: { reason: "missing-action", rows };
}

export function formatRefarmActionAffordanceRows(
	rows: readonly RefarmActionAffordanceRow[],
	heading = "Available actions:",
): string {
	if (rows.length === 0) return `${heading}\n  none`;
	return [heading, ...rows.map((row) => `  ${row.display}`)].join("\n");
}

export function formatRefarmActionIds(
	actions: readonly { id: string }[],
): string {
	return actions.length > 0
		? actions.map((action) => action.id).join(", ")
		: "none";
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

function resolveRefarmActionAffordanceRowIndex(
	rows: readonly RefarmActionAffordanceRow[],
	selection: string,
): RefarmActionAffordanceRow | undefined {
	if (!/^\d+$/.test(selection)) return undefined;
	const index = Number.parseInt(selection, 10);
	return rows.find((row) => row.index === index);
}
