import type { RefarmStatusJson } from "./status.js";
import { describe, expect, it } from "vitest";
import {
	createSurfaceActionAffordanceRows,
	createSurfaceActionReadinessDryRunEnvelope,
	createSurfaceActionReadinessLine,
	formatSurfaceActionAffordanceRows,
	formatSurfaceActionAffordanceSelection,
	formatSurfaceActionIds,
	formatSurfaceActionSelectionChoices,
	getStatusAvailableSurfaceActions,
	resolveSurfaceActionAffordanceSelection,
} from "./action-affordances.js";

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
			mode: "headless",
		},
		renderer: {
			id: "refarm-headless",
			kind: "headless",
			capabilities: ["surface-actions", "diagnostics"],
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

describe("Refarm action affordance helpers", () => {
	it("reads available actions from status with an empty fallback", () => {
		expect(getStatusAvailableSurfaceActions(makeStatus())).toHaveLength(2);
		expect(
			getStatusAvailableSurfaceActions({
				...makeStatus(),
				plugins: {
					installed: 0,
					active: 0,
					rejectedSurfaces: 0,
					surfaceActions: 0,
				},
			}),
		).toEqual([]);
	});

	it("creates stable rows shared by TUI and headless selection UX", () => {
		expect(createSurfaceActionAffordanceRows(makeStatus())).toEqual([
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

	it("formats rows with a caller-owned heading", () => {
		expect(
			formatSurfaceActionAffordanceRows(
				createSurfaceActionAffordanceRows(makeStatus()),
				"Available TUI actions:",
			),
		).toBe(`Available TUI actions:
  [1] Open node — open-node (node:open)
  [2] Inspect trust — inspect-trust`);
		expect(formatSurfaceActionAffordanceRows([])).toBe(
			"Available actions:\n  none",
		);
	});

	it("resolves selections by one-based row index or stable id", () => {
		expect(
			resolveSurfaceActionAffordanceSelection(makeStatus(), "1"),
		).toMatchObject({
			reason: "selected",
			selected: { id: "open-node" },
			selection: {
				requested: "1",
				source: "index",
				resolvedId: "open-node",
				index: 1,
			},
		});
		expect(
			resolveSurfaceActionAffordanceSelection(makeStatus(), " inspect-trust "),
		).toMatchObject({
			reason: "selected",
			selected: { index: 2, id: "inspect-trust" },
			selection: {
				requested: "inspect-trust",
				source: "id",
				resolvedId: "inspect-trust",
				index: 2,
			},
		});
	});

	it("creates shared dry-run envelopes for action readiness commands", () => {
		const status = makeStatus();
		const selection = resolveSurfaceActionAffordanceSelection(status, "2");

		expect(
			createSurfaceActionReadinessDryRunEnvelope(status, {
				command: "actions",
				renderer: "headless",
				selection,
			}),
		).toMatchObject({
			schemaVersion: 1,
			statusSchemaVersion: 1,
			reason: "dry-run",
			readiness: { status: "ready", label: "Ready: yes" },
			command: "actions",
			renderer: "headless",
			selection: {
				requested: "2",
				source: "index",
				resolvedId: "inspect-trust",
				index: 2,
			},
			selectedAction: { id: "inspect-trust", index: 2 },
			actionRows: [{ id: "open-node" }, { id: "inspect-trust" }],
		});

		expect(
			createSurfaceActionReadinessDryRunEnvelope(status, {
				renderer: "web",
			}),
		).toMatchObject({
			reason: "dry-run",
			readiness: { status: "ready", label: "Ready: yes" },
			renderer: "web",
			actionRows: [{ id: "open-node" }, { id: "inspect-trust" }],
		});
	});

	it("shares execution-plan readiness formatting for blocked action sets", () => {
		expect(createSurfaceActionReadinessLine(makeStatus([]))).toEqual({
			status: "blocked",
			label: "Blocked: no host actions available",
		});
		expect(
			createSurfaceActionReadinessLine(
				makeStatus(),
				resolveSurfaceActionAffordanceSelection(makeStatus(), "missing"),
			),
		).toEqual({
			status: "blocked",
			label: 'Blocked: host action "missing" is not available',
		});
		expect(
			createSurfaceActionReadinessDryRunEnvelope(makeStatus([]), {
				renderer: "tui",
			}),
		).toMatchObject({
			reason: "dry-run",
			readiness: {
				status: "blocked",
				label: "Blocked: no host actions available",
			},
			actionRows: [],
		});
	});

	it("formats selected action context with caller-owned headings", () => {
		const status = makeStatus();
		const selection = resolveSurfaceActionAffordanceSelection(status, "2");

		expect(
			formatSurfaceActionAffordanceSelection(
				selection.selected!,
				selection.rows,
				{
					selectedHeading: "Selected host action:",
					availableHeading: "Available host actions:",
					selection: selection.selection,
				},
			),
		).toBe(`Selected host action:
  [2] Inspect trust — inspect-trust
Selection:
  requested: 2
  resolved: inspect-trust
  source: index
Available host actions:
  [1] Open node — open-node (node:open)
  [2] Inspect trust — inspect-trust`);
	});

	it("reports missing selections and formats available IDs", () => {
		expect(
			resolveSurfaceActionAffordanceSelection(makeStatus(), "missing"),
		).toMatchObject({
			reason: "missing-action",
			selection: { requested: "missing", source: "id" },
		});
		expect(
			resolveSurfaceActionAffordanceSelection(makeStatus([]), "1"),
		).toMatchObject({
			reason: "no-actions",
			selection: { requested: "1", source: "index" },
		});
		expect(
			formatSurfaceActionIds(getStatusAvailableSurfaceActions(makeStatus())),
		).toBe("open-node, inspect-trust");
		expect(formatSurfaceActionIds([])).toBe("none");
		expect(
			formatSurfaceActionSelectionChoices(
				createSurfaceActionAffordanceRows(makeStatus()),
			),
		).toBe("[1] open-node, [2] inspect-trust");
		expect(formatSurfaceActionSelectionChoices([])).toBe("none");
	});
});
