import type {
	RefarmStatusJson,
	RefarmStatusSurfaceAction,
} from "@refarm.dev/cli/status";

export interface TuiSurfaceActionRow {
	index: number;
	id: string;
	label: string;
	intent?: string;
	display: string;
}

export type TuiSurfaceActionSelectionReason =
	| "selected"
	| "missing-action"
	| "no-actions";

export interface TuiSurfaceActionSelectionResult {
	selected?: TuiSurfaceActionRow;
	reason: TuiSurfaceActionSelectionReason;
	rows: readonly TuiSurfaceActionRow[];
}

export function createTuiSurfaceActionRows(
	status: RefarmStatusJson,
): TuiSurfaceActionRow[] {
	return (status.plugins.availableActions ?? []).map((action, index) =>
		createTuiSurfaceActionRow(action, index),
	);
}

export function resolveTuiSurfaceActionSelection(
	status: RefarmStatusJson,
	selection: string,
): TuiSurfaceActionSelectionResult {
	const rows = createTuiSurfaceActionRows(status);
	if (rows.length === 0) return { reason: "no-actions", rows };

	const normalizedSelection = selection.trim();
	const selectedByIndex = resolveTuiSurfaceActionRowIndex(
		rows,
		normalizedSelection,
	);
	const selected =
		selectedByIndex ?? rows.find((row) => row.id === normalizedSelection);

	return selected
		? { reason: "selected", selected, rows }
		: { reason: "missing-action", rows };
}

export function formatTuiSurfaceActionRows(
	rows: readonly TuiSurfaceActionRow[],
): string {
	if (rows.length === 0) return "Available TUI actions:\n  none";
	return [
		"Available TUI actions:",
		...rows.map((row) => `  ${row.display}`),
	].join("\n");
}

function createTuiSurfaceActionRow(
	action: RefarmStatusSurfaceAction,
	index: number,
): TuiSurfaceActionRow {
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

function resolveTuiSurfaceActionRowIndex(
	rows: readonly TuiSurfaceActionRow[],
	selection: string,
): TuiSurfaceActionRow | undefined {
	if (!/^\d+$/.test(selection)) return undefined;
	const index = Number.parseInt(selection, 10);
	return rows.find((row) => row.index === index);
}
