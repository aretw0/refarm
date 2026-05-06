import { describe, expect, it } from "vitest";
import type { RefarmStatusJson } from "@refarm.dev/cli/status";
import {
	createRefarmActionAffordanceRows,
	formatRefarmActionAffordanceRows,
	formatRefarmActionIds,
	getRefarmStatusAvailableActions,
	resolveRefarmActionAffordanceSelection,
} from "../../src/commands/action-affordances.js";

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
		expect(getRefarmStatusAvailableActions(makeStatus())).toHaveLength(2);
		expect(
			getRefarmStatusAvailableActions({
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
		expect(createRefarmActionAffordanceRows(makeStatus())).toEqual([
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
			formatRefarmActionAffordanceRows(
				createRefarmActionAffordanceRows(makeStatus()),
				"Available TUI actions:",
			),
		).toBe(`Available TUI actions:
  [1] Open node — open-node (node:open)
  [2] Inspect trust — inspect-trust`);
		expect(formatRefarmActionAffordanceRows([])).toBe(
			"Available actions:\n  none",
		);
	});

	it("resolves selections by one-based row index or stable id", () => {
		expect(resolveRefarmActionAffordanceSelection(makeStatus(), "1"))
			.toMatchObject({ reason: "selected", selected: { id: "open-node" } });
		expect(
			resolveRefarmActionAffordanceSelection(makeStatus(), " inspect-trust "),
		).toMatchObject({
			reason: "selected",
			selected: { index: 2, id: "inspect-trust" },
		});
	});

	it("reports missing selections and formats available IDs", () => {
		expect(resolveRefarmActionAffordanceSelection(makeStatus(), "missing"))
			.toMatchObject({ reason: "missing-action" });
		expect(resolveRefarmActionAffordanceSelection(makeStatus([]), "1"))
			.toMatchObject({ reason: "no-actions" });
		expect(formatRefarmActionIds(getRefarmStatusAvailableActions(makeStatus())))
			.toBe("open-node, inspect-trust");
		expect(formatRefarmActionIds([])).toBe("none");
	});
});
