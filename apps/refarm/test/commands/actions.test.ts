import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createActionsCommand,
	createHostSurfaceActionDryRunEnvelope,
	createHostSurfaceActionRows,
	formatHostSurfaceActionRows,
	formatHostSurfaceActionSelection,
	resolveHostSurfaceActionSelection,
} from "../../src/commands/actions.js";

function makeStatus(overrides?: Partial<any>) {
	return {
		schemaVersion: 1 as const,
		host: {
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			mode: "headless",
		},
		renderer: {
			id: "refarm-headless",
			kind: "headless" as const,
			capabilities: ["diagnostics"],
		},
		runtime: {
			ready: true,
			namespace: "refarm-main",
			databaseName: "refarm-main",
		},
		plugins: {
			installed: 0,
			active: 0,
			rejectedSurfaces: 0,
			surfaceActions: 0,
		},
		trust: {
			profile: "dev",
			warnings: 0,
			critical: 0,
		},
		streams: { active: 0, terminal: 0 },
		diagnostics: [],
		...overrides,
	};
}

const statusWithActions = makeStatus({
	plugins: {
		installed: 2,
		active: 2,
		rejectedSurfaces: 0,
		surfaceActions: 2,
		availableActions: [
			{ id: "open-status-report", label: "Open status report" },
			{
				id: "inspect-trust",
				label: "Inspect trust",
				intent: "trust:inspect",
			},
		],
	},
});

describe("host action readiness helpers", () => {
	it("creates stable one-based host action rows", () => {
		expect(createHostSurfaceActionRows(statusWithActions)).toEqual([
			expect.objectContaining({
				index: 1,
				id: "open-status-report",
				display: "[1] Open status report — open-status-report",
			}),
			expect.objectContaining({
				index: 2,
				id: "inspect-trust",
				display: "[2] Inspect trust — inspect-trust (trust:inspect)",
			}),
		]);
	});

	it("resolves host action selection by ID and row index", () => {
		expect(
			resolveHostSurfaceActionSelection(statusWithActions, "inspect-trust"),
		).toMatchObject({
			reason: "selected",
			selection: {
				requested: "inspect-trust",
				source: "id",
				resolvedId: "inspect-trust",
				index: 2,
			},
			selected: { id: "inspect-trust", index: 2 },
		});

		expect(resolveHostSurfaceActionSelection(statusWithActions, "2")).toMatchObject(
			{
				reason: "selected",
				selection: {
					requested: "2",
					source: "index",
					resolvedId: "inspect-trust",
					index: 2,
				},
				selected: { id: "inspect-trust", index: 2 },
			},
		);
	});

	it("formats host action rows and selected rows", () => {
		const rows = createHostSurfaceActionRows(statusWithActions);
		expect(formatHostSurfaceActionRows(rows)).toBe(`Available host actions:
  [1] Open status report — open-status-report
  [2] Inspect trust — inspect-trust (trust:inspect)`);

		expect(
			formatHostSurfaceActionSelection(rows[1]!, rows, {
				requested: "2",
				source: "index",
				resolvedId: "inspect-trust",
				index: 2,
			}),
		).toContain("Selected host action:");
	});

	it("creates deterministic renderer-neutral dry-run envelopes", () => {
		const selection = resolveHostSurfaceActionSelection(statusWithActions, "2");
		expect(
			createHostSurfaceActionDryRunEnvelope(statusWithActions, selection),
		).toMatchObject({
			schemaVersion: 1,
			statusSchemaVersion: 1,
			reason: "dry-run",
			command: "actions",
			renderer: "headless",
			selection: {
				requested: "2",
				source: "index",
				resolvedId: "inspect-trust",
				index: 2,
			},
			selectedAction: { id: "inspect-trust", index: 2 },
			actionRows: [
				{ id: "open-status-report", index: 1 },
				{ id: "inspect-trust", index: 2 },
			],
		});
	});
});

describe("actionsCommand", () => {
	const resolveStatusPayload = vi.fn();
	const shutdown = vi.fn().mockResolvedValue(undefined);

	beforeEach(() => {
		vi.clearAllMocks();
		resolveStatusPayload.mockResolvedValue({ json: statusWithActions, shutdown });
	});

	it("prints host action rows without executing actions", async () => {
		const command = createActionsCommand({ resolveStatusPayload });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync([], { from: "user" });

		expect(resolveStatusPayload).toHaveBeenCalledWith({
			renderer: "headless",
			input: undefined,
		});
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Available host actions:"),
		);
		expect(shutdown).toHaveBeenCalled();
		logSpy.mockRestore();
	});

	it("prints selected host action metadata", async () => {
		const command = createActionsCommand({ resolveStatusPayload });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--select", "2"], { from: "user" });

		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("Selected host action:"),
		);
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining("source: index"),
		);
		logSpy.mockRestore();
	});

	it("prints JSON dry-run envelopes", async () => {
		const command = createActionsCommand({ resolveStatusPayload });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(["--select", "inspect-trust", "--json"], {
			from: "user",
		});

		const output = JSON.parse(String(logSpy.mock.calls[0]?.[0]));
		expect(output).toMatchObject({
			schemaVersion: 1,
			reason: "dry-run",
			command: "actions",
			renderer: "headless",
			selection: {
				requested: "inspect-trust",
				source: "id",
				resolvedId: "inspect-trust",
				index: 2,
			},
			selectedAction: { id: "inspect-trust", index: 2 },
		});
		logSpy.mockRestore();
	});

	it("passes renderer and input options to status resolution", async () => {
		const command = createActionsCommand({ resolveStatusPayload });
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			["--renderer", "web", "--input", "status.json", "--json"],
			{ from: "user" },
		);

		expect(resolveStatusPayload).toHaveBeenCalledWith({
			renderer: "web",
			input: "status.json",
		});
		logSpy.mockRestore();
	});

	it("rejects unavailable host action selections", async () => {
		const command = createActionsCommand({ resolveStatusPayload });

		await expect(
			command.parseAsync(["--select", "missing-action"], { from: "user" }),
		).rejects.toThrow(/Host action "missing-action" is not available/);
	});
});
