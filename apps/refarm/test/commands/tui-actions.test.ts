import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import { describe, expect, it } from "vitest";
import {
	createTuiSurfaceActionDryRunEnvelope,
	createTuiSurfaceActionRows,
	formatTuiSurfaceActionRows,
	formatTuiSurfaceActionSelection,
	resolveTuiSurfaceActionSelection,
} from "../../src/commands/tui-actions.js";

function makeStatus(
	actions: RefarmStatusJson["plugins"]["availableActions"] = [
		{ id: "open-node", label: "Open node", intent: "node:open" },
		{ id: "inspect-trust", label: "Inspect trust" },
	],
): RefarmStatusJson {
	return {
		schemaVersion: 1,
		host: {
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			mode: "tui",
		},
		renderer: {
			id: "refarm-tui",
			kind: "tui",
			capabilities: ["interactive", "surface-actions", "diagnostics"],
		},
		runtime: {
			ready: true,
			namespace: "refarm-main",
			databaseName: "refarm-main",
		},
		plugins: {
			installed: actions?.length ?? 0,
			active: actions?.length ?? 0,
			rejectedSurfaces: 0,
			surfaceActions: actions?.length ?? 0,
			availableActions: actions,
		},
		trust: { profile: "dev", warnings: 0, critical: 0 },
		streams: { active: 0, terminal: 0 },
		diagnostics: actions?.length ? ["plugins:surface-actions-available"] : [],
	};
}

describe("TUI surface action rows", () => {
	it("creates deterministic selectable rows from status affordances", () => {
		expect(createTuiSurfaceActionRows(makeStatus())).toEqual([
			{
				index: 1,
				id: "open-node",
				label: "Open node",
				intent: "node:open",
				display: "[1] Open node — open-node (node:open)",
			},
			{
				index: 2,
				id: "inspect-trust",
				label: "Inspect trust",
				intent: undefined,
				display: "[2] Inspect trust — inspect-trust",
			},
		]);
	});

	it("formats rows for non-interactive TUI readiness output", () => {
		expect(
			formatTuiSurfaceActionRows(createTuiSurfaceActionRows(makeStatus())),
		).toBe(`Available TUI actions:
  [1] Open node — open-node (node:open)
  [2] Inspect trust — inspect-trust`);
	});

	it("formats a selected action with the full action row context", () => {
		const selection = resolveTuiSurfaceActionSelection(makeStatus(), "2");

		expect(selection.selected).toBeDefined();
		expect(
			formatTuiSurfaceActionSelection(
				selection.selected!,
				selection.rows,
				selection.selection,
			),
		).toBe(`Selected TUI action:
  [2] Inspect trust — inspect-trust
Selection:
  requested: 2
  resolved: inspect-trust
  source: index
Available TUI actions:
  [1] Open node — open-node (node:open)
  [2] Inspect trust — inspect-trust`);
	});

	it("creates deterministic JSON dry-run envelopes", () => {
		const status = makeStatus();
		const selection = resolveTuiSurfaceActionSelection(status, "2");

		expect(createTuiSurfaceActionDryRunEnvelope(status, selection)).toEqual({
			schemaVersion: 1,
			statusSchemaVersion: 1,
			reason: "dry-run",
			readiness: { status: "ready", label: "Ready: yes" },
			renderer: "tui",
			nextAction: null,
			nextActions: [],
			nextCommand: null,
			nextCommands: [],
			selection: {
				requested: "2",
				source: "index",
				resolvedId: "inspect-trust",
				index: 2,
			},
			selectedAction: expect.objectContaining({ id: "inspect-trust" }),
			actionRows: [
				expect.objectContaining({ id: "open-node" }),
				expect.objectContaining({ id: "inspect-trust" }),
			],
		});
		expect(createTuiSurfaceActionDryRunEnvelope(status)).toMatchObject({
			renderer: "tui",
			actionRows: [{ id: "open-node" }, { id: "inspect-trust" }],
		});
	});

	it("renders an explicit empty state", () => {
		expect(
			formatTuiSurfaceActionRows(createTuiSurfaceActionRows(makeStatus([]))),
		).toBe("Available TUI actions:\n  none");
		expect(createTuiSurfaceActionDryRunEnvelope(makeStatus([]))).toMatchObject({
			readiness: {
				status: "blocked",
				label: "Blocked: no host actions available",
			},
			actionRows: [],
		});
	});

	it("resolves selections by row index or stable action id", () => {
		expect(resolveTuiSurfaceActionSelection(makeStatus(), "1")).toMatchObject({
			reason: "selected",
			selected: { id: "open-node" },
		});
		expect(
			resolveTuiSurfaceActionSelection(makeStatus(), "inspect-trust"),
		).toMatchObject({
			reason: "selected",
			selected: { index: 2, id: "inspect-trust" },
		});
	});

	it("reports missing selections without inventing fallback behavior", () => {
		const missingSelection = resolveTuiSurfaceActionSelection(
			makeStatus(),
			"missing",
		);
		expect(missingSelection).toMatchObject({ reason: "missing-action" });
		expect(
			createTuiSurfaceActionDryRunEnvelope(makeStatus(), missingSelection),
		).toMatchObject({
			readiness: {
				status: "blocked",
				label: 'Blocked: host action "missing" is not available',
			},
		});
		expect(resolveTuiSurfaceActionSelection(makeStatus([]), "1")).toMatchObject(
			{ reason: "no-actions" },
		);
	});
});
