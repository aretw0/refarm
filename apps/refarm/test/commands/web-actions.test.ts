import { describe, expect, it } from "vitest";
import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import {
	createWebSurfaceActionDryRunEnvelope,
	createWebSurfaceActionRows,
	formatWebSurfaceActionRows,
	formatWebSurfaceActionSelection,
	resolveWebSurfaceActionSelection,
} from "../../src/commands/web-actions.js";

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
			mode: "web",
		},
		renderer: {
			id: "refarm-web",
			kind: "web",
			capabilities: ["interactive", "rich-html", "surface-actions"],
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

describe("Web surface action rows", () => {
	it("creates deterministic selectable rows from status affordances", () => {
		expect(createWebSurfaceActionRows(makeStatus())).toEqual([
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

	it("formats rows for non-launching Web readiness output", () => {
		expect(
			formatWebSurfaceActionRows(createWebSurfaceActionRows(makeStatus())),
		).toBe(`Available Web actions:
  [1] Open node — open-node (node:open)
  [2] Inspect trust — inspect-trust`);
	});

	it("formats a selected action with the full action row context", () => {
		const selection = resolveWebSurfaceActionSelection(makeStatus(), "2");

		expect(selection.selected).toBeDefined();
		expect(
			formatWebSurfaceActionSelection(
				selection.selected!,
				selection.rows,
				selection.selection,
			),
		).toBe(`Selected Web action:
  [2] Inspect trust — inspect-trust
Selection:
  requested: 2
  resolved: inspect-trust
  source: index
Available Web actions:
  [1] Open node — open-node (node:open)
  [2] Inspect trust — inspect-trust`);
	});

	it("creates deterministic JSON dry-run envelopes", () => {
		const status = makeStatus();
		const selection = resolveWebSurfaceActionSelection(status, "2");

		expect(createWebSurfaceActionDryRunEnvelope(status, selection)).toEqual({
			schemaVersion: 1,
			statusSchemaVersion: 1,
			reason: "dry-run",
			renderer: "web",
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
		expect(createWebSurfaceActionDryRunEnvelope(status)).toMatchObject({
			renderer: "web",
			actionRows: [{ id: "open-node" }, { id: "inspect-trust" }],
		});
	});

	it("renders an explicit empty state", () => {
		expect(
			formatWebSurfaceActionRows(createWebSurfaceActionRows(makeStatus([]))),
		).toBe("Available Web actions:\n  none");
	});

	it("resolves selections by row index or stable action id", () => {
		expect(resolveWebSurfaceActionSelection(makeStatus(), "1")).toMatchObject({
			reason: "selected",
			selected: { id: "open-node" },
		});
		expect(
			resolveWebSurfaceActionSelection(makeStatus(), "inspect-trust"),
		).toMatchObject({
			reason: "selected",
			selected: { index: 2, id: "inspect-trust" },
		});
	});

	it("reports missing selections without inventing fallback behavior", () => {
		expect(
			resolveWebSurfaceActionSelection(makeStatus(), "missing"),
		).toMatchObject({ reason: "missing-action" });
		expect(resolveWebSurfaceActionSelection(makeStatus([]), "1")).toMatchObject(
			{ reason: "no-actions" },
		);
	});
});
